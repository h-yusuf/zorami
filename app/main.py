from fastapi import FastAPI

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
