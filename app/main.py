from fastapi import FastAPI

from app.device.ota import ota_router

app = FastAPI(title="Zora Bridge")
app.include_router(ota_router)
