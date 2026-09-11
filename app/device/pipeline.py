import audioop
import json
import time
from typing import TYPE_CHECKING, AsyncIterator, TypedDict

from app.adapters.llm.base import LLMAdapter
from app.adapters.search.base import SearchAdapter
from app.adapters.stt.base import STTAdapter
from app.adapters.tts.base import TTSAdapter
from app.device.opus_codec import encode as opus_encode

if TYPE_CHECKING:
    from app.device.mcp_client import McpClient

_SEARCH_TOOL_NAME = "web_search"

# Opus cuma menerima 5 sample rate ini (8k/12k/16k/24k/48k) - encoder melempar
# "invalid argument" untuk rate lain. TTS adapter boleh punya sample rate model
# apa saja (mis. voice Piper id_ID kita 22050Hz), jadi resample dulu ke rate
# downlink yang dinegosiasikan ke device (lihat _DOWNLINK_AUDIO_PARAMS di ws.py)
# sebelum encode - ditemukan lewat tes manual voice loop end-to-end sungguhan.
_OPUS_VALID_RATES = {8000, 12000, 16000, 24000, 48000}
_DOWNLINK_RATE = 24000

_SEARCH_TOOL_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Cari informasi terkini di internet, misalnya cuaca, berita, atau harga.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    }
]


class OutgoingEvent(TypedDict, total=False):
    kind: str
    text: str
    data: bytes


class Pipeline:
    def __init__(
        self,
        stt: STTAdapter,
        llm: LLMAdapter,
        tts: TTSAdapter,
        voice: str,
        system_prompt: str,
        search: SearchAdapter | None = None,
        mcp: "McpClient | None" = None,
        max_tokens: int = 160,
        temperature: float = 0.7,
        providers_used: dict[str, str] | None = None,
    ):
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._voice = voice
        self._system_prompt = system_prompt
        self._search = search
        self._mcp = mcp
        self._max_tokens = max_tokens
        self._temperature = temperature
        self._providers_used = providers_used or {}
        # Diisi tiap kali handle_utterance() jalan - dibaca ws.py setelah turn
        # selesai buat nyimpen latensi per-stage yang SUNGGUHAN ke Message,
        # bukan placeholder. Sebelumnya Message.latency_ms/provider_used tidak
        # pernah ditulis sama sekali walau kolomnya sudah ada di schema.
        self.last_latency_ms: dict[str, int] = {}
        self.last_provider_used: dict[str, str] = {}

    async def _build_tool_schema(self) -> list[dict] | None:
        tools: list[dict] = []
        if self._search is not None:
            tools.append(_SEARCH_TOOL_SCHEMA[0])
        if self._mcp is not None:
            for tool in await self._mcp.get_allowed_tools():
                tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": tool["name"],
                            "description": tool.get("description", ""),
                            "parameters": tool.get(
                                "inputSchema", {"type": "object", "properties": {}}
                            ),
                        },
                    }
                )
        return tools or None

    async def handle_utterance(self, pcm_audio: bytes) -> AsyncIterator[OutgoingEvent]:
        turn_start = time.monotonic()
        self.last_latency_ms = {}
        self.last_provider_used = dict(self._providers_used)

        t0 = time.monotonic()
        stt_result = await self._stt.transcribe(pcm_audio, sample_rate=16000)
        self.last_latency_ms["stt"] = int((time.monotonic() - t0) * 1000)
        yield OutgoingEvent(kind="stt", text=stt_result.text)

        messages = [
            {"role": "system", "content": self._system_prompt},
            {"role": "user", "content": stt_result.text},
        ]

        tools = await self._build_tool_schema()
        t0 = time.monotonic()
        llm_result = await self._llm.complete(
            messages=messages, tools=tools, max_tokens=self._max_tokens, temperature=self._temperature
        )
        llm_elapsed = time.monotonic() - t0

        if llm_result.tool_calls:
            call = llm_result.tool_calls[0]
            tool_name = call["function"]["name"]
            args = json.loads(call["function"]["arguments"] or "{}")

            if tool_name == _SEARCH_TOOL_NAME and self._search is not None:
                t0 = time.monotonic()
                search_result = await self._search.search(args["query"], max_results=3)
                self.last_latency_ms["search"] = int((time.monotonic() - t0) * 1000)
                tool_content = "\n".join(
                    f"- {r['title']}: {r['snippet']}" for r in search_result.results
                )
            elif self._mcp is not None:
                mcp_result = await self._mcp.call_tool(tool_name, args)
                tool_content = "\n".join(
                    part.get("text", "") for part in mcp_result.get("content", [])
                )
            else:
                tool_content = ""

            messages.append({"role": "assistant", "content": None, "tool_calls": llm_result.tool_calls})
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": tool_content})
            t0 = time.monotonic()
            llm_result = await self._llm.complete(
                messages=messages, max_tokens=self._max_tokens, temperature=self._temperature
            )
            llm_elapsed += time.monotonic() - t0

        self.last_latency_ms["llm"] = int(llm_elapsed * 1000)

        final_text = llm_result.text
        t0 = time.monotonic()
        tts_result = await self._tts.synthesize(final_text, voice=self._voice)
        self.last_latency_ms["tts"] = int((time.monotonic() - t0) * 1000)
        # "total" berhenti di sini (audio pertama siap), bukan di akhir loop
        # pengiriman frame - itu dipacer real-time jadi bukan latensi beneran,
        # ini yang dimaksud "mulut ke telinga" di dashboard.
        self.last_latency_ms["total"] = int((time.monotonic() - turn_start) * 1000)

        yield OutgoingEvent(kind="tts_start")
        yield OutgoingEvent(kind="tts_sentence", text=llm_result.text)

        pcm = tts_result.pcm_audio
        sample_rate = tts_result.sample_rate
        if sample_rate not in _OPUS_VALID_RATES:
            pcm, _ = audioop.ratecv(pcm, 2, 1, sample_rate, _DOWNLINK_RATE, None)
            sample_rate = _DOWNLINK_RATE

        frame_bytes = 2 * (sample_rate * 60 // 1000)  # 16-bit mono, 60ms
        for offset in range(0, len(pcm), frame_bytes):
            chunk = pcm[offset : offset + frame_bytes]
            if len(chunk) < frame_bytes:
                chunk = chunk + b"\x00" * (frame_bytes - len(chunk))
            opus_packet = opus_encode(chunk, sample_rate=sample_rate, frame_duration_ms=60)
            yield OutgoingEvent(kind="audio_frame", data=opus_packet)

        yield OutgoingEvent(kind="tts_stop")
