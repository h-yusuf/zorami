import asyncio
import json
from typing import Any

from app.core.bus import publish

# Allowlist tool MCP yang boleh diekspos ke LLM.
# self.reboot dan self.upgrade_firmware TIDAK boleh di sini - lihat DANGEROUS_TOOLS.
DEFAULT_ALLOWLIST: set[str] = {
    "self.get_device_status",
    "self.audio_speaker.set_volume",
    "self.screen.set_brightness",
    "self.screen.set_theme",
    "self.camera.take_photo",
}

# Tool berbahaya yang TIDAK boleh diekspos ke LLM walau device mengembalikannya
# di tools/list. DoToolCall firmware tidak memeriksa withUserTools sebelum
# mengeksekusi (spec §5) - jadi allowlist di bridge adalah satu-satunya filter.
DANGEROUS_TOOLS: set[str] = {
    "self.reboot",
    "self.upgrade_firmware",
}


class McpClient:
    """JSON-RPC client ke device MCP server via WebSocket session."""

    def __init__(self, ws_send_fn, *, call_timeout: float = 10.0, allowlist: set[str] | None = None):
        self._send = ws_send_fn  # async fn(str) -> None
        self._call_timeout = call_timeout
        self._allowlist = allowlist or DEFAULT_ALLOWLIST
        self._pending: dict[int, asyncio.Future] = {}
        self._next_id: int = 1

    async def initialize(self) -> dict[str, Any] | None:
        """Kirim initialize sekali per koneksi - satu-satunya isi balasan yang
        dipakai device adalah URL+token vision kamera (spec §5)."""
        return await self._call("initialize", {})

    async def list_tools(self, cursor: str | None = None, with_user_tools: bool = True) -> dict[str, Any]:
        """Paginasi tools/list berbasis NAMA TOOL (bukan indeks). Batas 8000 byte
        JSON hasil di sisi device (spec §5)."""
        params: dict[str, Any] = {"withUserTools": with_user_tools}
        if cursor is not None:
            params["cursor"] = cursor

        return await self._call("tools/list", params)

    async def list_all_tools(self) -> list[dict[str, Any]]:
        all_tools: list[dict[str, Any]] = []
        cursor: str | None = None

        while True:
            page = await self.list_tools(cursor=cursor, with_user_tools=True)
            all_tools.extend(page.get("tools", []))

            cursor = page.get("nextCursor")
            if cursor is None:
                break

        return all_tools

    async def get_allowed_tools(self) -> list[dict[str, Any]]:
        all_tools = await self.list_all_tools()
        return [t for t in all_tools if t.get("name") in self._allowlist]

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        if name in DANGEROUS_TOOLS:
            return {
                "isError": True,
                "content": [{"type": "text", "text": f"Tool '{name}' diblokir oleh allowlist bridge"}],
            }
        if name not in self._allowlist:
            return {
                "isError": True,
                "content": [{"type": "text", "text": f"Tool '{name}' tidak ada di allowlist bridge"}],
            }

        return await self._call("tools/call", {"name": name, "arguments": arguments or {}})

    async def handle_response(self, msg: str) -> None:
        """Terima balasan JSON-RPC dari device, selesaikan future yang menunggu."""
        data = json.loads(msg)
        rpc_id = data.get("id")
        if rpc_id is None or not isinstance(rpc_id, int):
            return

        future = self._pending.pop(rpc_id, None)
        if future is None or future.done():
            return

        if "error" in data:
            # Firmware hanya mengirim "message", tanpa "code" (spec §5) - dokumentasi
            # firmware yang menyebut -32601 itu keliru.
            err = data["error"]
            future.set_result(
                {"isError": True, "content": [{"type": "text", "text": err.get("message", "unknown error")}]}
            )
        elif "result" in data:
            future.set_result(data["result"])
        else:
            future.set_result({"isError": True, "content": [{"type": "text", "text": "malformed response"}]})

    async def _call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        rpc_id = self._next_id
        self._next_id += 1

        msg = json.dumps({"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params})

        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[rpc_id] = future

        await self._send(msg)
        await publish("device.mcp_call", {"method": method, "id": rpc_id})

        try:
            return await asyncio.wait_for(future, timeout=self._call_timeout)
        except asyncio.TimeoutError:
            self._pending.pop(rpc_id, None)
            return {
                "isError": True,
                "content": [
                    {"type": "text", "text": f"timeout: device tidak merespons {method} dalam {self._call_timeout}s"}
                ],
            }
