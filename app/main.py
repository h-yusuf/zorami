import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.types import Scope

from app.control.auth import router as auth_router
from app.control.rest.agents import router as agents_router
from app.control.rest.conversations import router as conversations_router
from app.control.rest.devices import router as devices_router
from app.control.monitor import router as monitor_router
from app.control.rest.overview import router as overview_router
from app.control.rest.providers import router as providers_router
from app.device.ota import ota_router
from app.device.ws import ws_router

app = FastAPI(title="Zora Bridge")
app.include_router(ota_router)
app.include_router(ws_router)
app.include_router(auth_router)
app.include_router(agents_router)
app.include_router(providers_router)
app.include_router(devices_router)
app.include_router(conversations_router)
app.include_router(overview_router)
app.include_router(monitor_router)


class SPAStaticFiles(StaticFiles):
    """StaticFiles yang fallback ke index.html buat path yang tidak match file
    static apapun - dibutuhkan supaya client-side routing React Router tetap
    kerja pas user refresh/buka langsung route seperti "/agents"."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


# Serve built frontend (dashboard SPA) - HARUS di baris paling terakhir setelah
# semua router API/WS di-mount, supaya catch-all StaticFiles tidak menimpa
# "/api/*" atau "/ws/*". Mount defensif: kalau "frontend/dist/" belum ada
# (misal env dev/CI sebelum "npm run build" pernah jalan), skip dengan warning
# alih-alih crash startup - Fase 1 (voice loop, dipakai pytest) tidak butuh
# frontend sama sekali.
_frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", SPAStaticFiles(directory=_frontend_dist, html=True), name="frontend")
else:
    logging.getLogger(__name__).warning(
        "frontend/dist tidak ditemukan (%s) - static file mount dilewati. "
        "Jalankan 'npm run build' di folder frontend/ untuk menyajikan dashboard.",
        _frontend_dist,
    )
