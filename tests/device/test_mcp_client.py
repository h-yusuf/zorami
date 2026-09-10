import asyncio
import json

from app.device.mcp_client import DANGEROUS_TOOLS, DEFAULT_ALLOWLIST, McpClient


async def test_list_tools_single_page():
    async def mock_send(msg: str):
        pass

    client = McpClient(mock_send)

    async def respond():
        await asyncio.sleep(0.01)
        await client.handle_response(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {"tools": [{"name": "take_photo", "description": "ambil foto"}]},
                }
            )
        )

    asyncio.create_task(respond())
    result = await client.list_tools()

    assert len(result["tools"]) == 1
    assert "nextCursor" not in result or result.get("nextCursor") is None


async def test_list_tools_pagination():
    # mock_send bereaksi terhadap PESAN yang beneran dikirim (bukan urutan task
    # yang diasumsikan) - deterministik, tidak rentan race antar task respond().
    client_holder: dict[str, McpClient] = {}

    async def mock_send(msg: str):
        envelope = json.loads(msg)
        rpc_id = envelope["payload"]["id"]
        if rpc_id == 1:
            response = {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {"tools": [{"name": "tool_a"}], "nextCursor": "tool_b"},
            }
        else:
            response = {"jsonrpc": "2.0", "id": rpc_id, "result": {"tools": [{"name": "tool_b"}]}}
        asyncio.get_event_loop().call_soon(
            lambda: asyncio.create_task(client_holder["client"].handle_response(json.dumps(response)))
        )

    client = McpClient(mock_send)
    client_holder["client"] = client

    all_tools = await client.list_all_tools()
    assert len(all_tools) == 2
    assert [t["name"] for t in all_tools] == ["tool_a", "tool_b"]


async def test_call_tool_allowed():
    async def mock_send(msg: str):
        pass

    client = McpClient(mock_send, allowlist={"take_photo"})

    async def respond():
        await asyncio.sleep(0.01)
        await client.handle_response(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {"content": [{"type": "text", "text": "photo data"}], "isError": False},
                }
            )
        )

    asyncio.create_task(respond())
    result = await client.call_tool("take_photo", {})

    assert result["isError"] is False
    assert result["content"][0]["text"] == "photo data"


async def test_call_tool_dangerous_blocked():
    async def mock_send(msg: str):
        pass

    client = McpClient(mock_send, allowlist={"take_photo"})
    result = await client.call_tool("self.reboot", {})

    assert result["isError"] is True
    assert "diblokir" in result["content"][0]["text"]


async def test_call_tool_not_in_allowlist_blocked():
    async def mock_send(msg: str):
        pass

    client = McpClient(mock_send, allowlist={"take_photo"})
    result = await client.call_tool("unknown_tool", {})

    assert result["isError"] is True
    assert "allowlist" in result["content"][0]["text"]


async def test_call_tool_timeout():
    async def mock_send(msg: str):
        pass  # device tidak pernah balas

    client = McpClient(mock_send, call_timeout=0.1, allowlist={"take_photo"})
    result = await client.call_tool("take_photo", {})

    assert result["isError"] is True
    assert "timeout" in result["content"][0]["text"]


async def test_handle_error_response():
    async def mock_send(msg: str):
        pass

    client = McpClient(mock_send, allowlist={"take_photo"})

    async def respond():
        await asyncio.sleep(0.01)
        await client.handle_response(
            json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"message": "device busy"}})
        )

    asyncio.create_task(respond())
    result = await client.call_tool("take_photo", {})

    assert result["isError"] is True
    assert result["content"][0]["text"] == "device busy"


async def test_id_is_integer():
    sent = []

    async def mock_send(msg: str):
        sent.append(msg)

    client = McpClient(mock_send)

    async def respond():
        await asyncio.sleep(0.01)
        await client.handle_response(json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": []}}))

    asyncio.create_task(respond())
    await client.list_tools()

    envelope = json.loads(sent[0])
    assert envelope["type"] == "mcp"
    assert isinstance(envelope["payload"]["id"], int)


def test_outgoing_call_wrapped_in_mcp_envelope():
    sent = []

    async def mock_send(msg: str):
        sent.append(msg)

    async def run():
        client = McpClient(mock_send, session_id="sess-123")
        # Tidak menunggu balasan - cukup periksa envelope yang terkirim.
        asyncio.create_task(client.list_tools())
        await asyncio.sleep(0.01)

    asyncio.run(run())

    envelope = json.loads(sent[0])
    assert envelope["session_id"] == "sess-123"
    assert envelope["type"] == "mcp"
    assert envelope["payload"]["method"] == "tools/list"


def test_dangerous_tools_never_in_default_allowlist():
    assert DEFAULT_ALLOWLIST.isdisjoint(DANGEROUS_TOOLS)
