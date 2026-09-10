from fastapi import FastAPI

from app.control.auth import router as auth_router
from app.device.ota import ota_router
from app.device.ws import ws_router

app = FastAPI(title="Zora Bridge")
app.include_router(ota_router)
app.include_router(ws_router)
app.include_router(auth_router)
