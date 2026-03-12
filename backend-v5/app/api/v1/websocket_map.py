"""WebSocket endpoint for real-time map overlays."""
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Set, Dict, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.api.deps import require_dev
from app.core.realtime_bus import publish_map
from app.core.database import AsyncSessionLocal
from app.services.auth_service import AuthService

router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)


async def _authenticate_websocket(websocket: WebSocket) -> bool:
    """Validate ?token= access token for WebSocket connections."""
    token = websocket.query_params.get("token")
    if not token:
        return False

    payload = AuthService.decode_token(token)
    if not payload or payload.type != "access":
        return False

    try:
        user_id = UUID(payload.sub)
    except ValueError:
        return False

    async with AsyncSessionLocal() as db:
        auth = AuthService(db)
        user = await auth.get_user_by_id(user_id)
        if not user or not user.is_active:
            return False

    return True


# ============================================================================
# Connection Manager
# ============================================================================


class MapConnectionManager:
    """Manages WebSocket connections for map updates."""

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.connection_metadata: Dict[WebSocket, Dict[str, Any]] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections.add(websocket)
        self.connection_metadata[websocket] = {
            "client_id": client_id,
            "connected_at": datetime.now(timezone.utc).isoformat(),
            "subscriptions": set(),  # What event types this client wants
        }
        logger.info(f"Map WebSocket client connected: {client_id}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        if websocket in self.connection_metadata:
            client_id = self.connection_metadata[websocket].get("client_id", "unknown")
            del self.connection_metadata[websocket]
            logger.info(f"Map WebSocket client disconnected: {client_id}")

    async def subscribe(self, websocket: WebSocket, event_types: list):
        """Subscribe a client to specific event types."""
        if websocket in self.connection_metadata:
            self.connection_metadata[websocket]["subscriptions"].update(event_types)

    async def broadcast(self, message: dict, event_type: str = None):
        """Broadcast message to all connected clients."""
        disconnected = []

        for connection in self.active_connections:
            try:
                # Check if client is subscribed to this event type
                if event_type:
                    subs = self.connection_metadata.get(connection, {}).get("subscriptions", set())
                    if subs and event_type not in subs:
                        continue

                await connection.send_json(message)

            except Exception as e:
                logger.error(f"Error sending to client: {e}")
                disconnected.append(connection)

        # Clean up disconnected clients
        for conn in disconnected:
            self.disconnect(conn)

    async def send_to_client(self, websocket: WebSocket, message: dict):
        """Send message to a specific client."""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Error sending to client: {e}")
            self.disconnect(websocket)


manager = MapConnectionManager()


# ============================================================================
# Message Types
# ============================================================================


class MapMessage(BaseModel):
    """Base map message structure."""
    type: str  # event_type
    timestamp: str
    data: dict


def create_river_alert_message(
    station_id: str,
    station_name: str,
    district: str,
    lat: float,
    lng: float,
    water_level: float,
    alert_level: str,  # normal, warning, danger, extreme
    trend: str,  # rising, stable, falling
) -> dict:
    """Create a river alert broadcast message."""
    return {
        "type": "river_alert",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "id": str(uuid4()),
            "station_id": station_id,
            "station_name": station_name,
            "district": district,
            "coordinates": {"lat": lat, "lng": lng},
            "water_level": water_level,
            "alert_level": alert_level,
            "trend": trend,
            "message": f"{station_name} water level at {water_level}m ({alert_level.upper()})",
        },
    }


def create_curfew_update_message(
    curfew_id: str,
    district: str,
    status: str,  # active, ended, extended
    polygon: list,  # List of [lat, lng] coordinates
    start_time: str,
    end_time: str,
    reason: str,
) -> dict:
    """Create a curfew zone update message."""
    return {
        "type": "curfew_update",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "id": curfew_id,
            "district": district,
            "status": status,
            "polygon": polygon,
            "start_time": start_time,
            "end_time": end_time,
            "reason": reason,
        },
    }


def create_incident_marker_message(
    incident_id: str,
    title: str,
    category: str,
    severity: str,
    lat: float,
    lng: float,
    district: str,
    source: str,
    story_id: str = None,
) -> dict:
    """Create a new incident marker message."""
    return {
        "type": "incident_marker",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "id": incident_id,
            "title": title,
            "category": category,
            "severity": severity,
            "coordinates": {"lat": lat, "lng": lng},
            "district": district,
            "source": source,
            "story_id": story_id,
            "animate": True,  # Frontend should animate this marker
        },
    }


def create_seismic_event_message(
    event_id: str,
    magnitude: float,
    depth_km: float,
    lat: float,
    lng: float,
    location: str,
    event_time: str,
) -> dict:
    """Create a seismic event message."""
    return {
        "type": "seismic_event",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "id": event_id,
            "magnitude": magnitude,
            "depth_km": depth_km,
            "coordinates": {"lat": lat, "lng": lng},
            "location": location,
            "event_time": event_time,
            "animate": True,
        },
    }


# ============================================================================
# WebSocket Endpoint
# ============================================================================


@router.websocket("/ws/map")
async def websocket_map_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time map updates.

    Supported message types from client:
    - subscribe: {"type": "subscribe", "event_types": ["river_alert", "curfew_update", ...]}
    - unsubscribe: {"type": "unsubscribe", "event_types": [...]}
    - ping: {"type": "ping"}

    Server broadcasts:
    - river_alert: River gauge alerts with coordinates
    - curfew_update: Curfew zone changes with polygons
    - incident_marker: New incident markers with animation
    - seismic_event: Earthquake events
    """
    # Auth-first (reject without accepting)
    is_authed = await _authenticate_websocket(websocket)
    if not is_authed:
        await websocket.close(code=1008)
        return

    client_id = str(uuid4())[:8]

    try:
        await manager.connect(websocket, client_id)

        # Send welcome message
        await manager.send_to_client(websocket, {
            "type": "connected",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {
                "client_id": client_id,
                "message": "Connected to map WebSocket",
                "available_subscriptions": [
                    "river_alert",
                    "curfew_update",
                    "incident_marker",
                    "seismic_event",
                ],
            },
        })

        # Listen for client messages
        while True:
            try:
                data = await websocket.receive_json()
                msg_type = data.get("type")

                if msg_type == "subscribe":
                    event_types = data.get("event_types", [])
                    await manager.subscribe(websocket, event_types)
                    await manager.send_to_client(websocket, {
                        "type": "subscribed",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "data": {"event_types": event_types},
                    })

                elif msg_type == "unsubscribe":
                    event_types = data.get("event_types", [])
                    meta = manager.connection_metadata.get(websocket, {})
                    subs = meta.get("subscriptions", set())
                    for et in event_types:
                        subs.discard(et)
                    await manager.send_to_client(websocket, {
                        "type": "unsubscribed",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "data": {"event_types": event_types},
                    })

                elif msg_type == "ping":
                    await manager.send_to_client(websocket, {
                        "type": "pong",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })

                else:
                    await manager.send_to_client(websocket, {
                        "type": "error",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "data": {"message": f"Unknown message type: {msg_type}"},
                    })

            except json.JSONDecodeError:
                await manager.send_to_client(websocket, {
                    "type": "error",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data": {"message": "Invalid JSON"},
                })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)


# ============================================================================
# Broadcast Functions (called by other services)
# ============================================================================


async def broadcast_river_alert(
    station_id: str,
    station_name: str,
    district: str,
    lat: float,
    lng: float,
    water_level: float,
    alert_level: str,
    trend: str,
):
    """Broadcast a river alert to all subscribed map clients."""
    message = create_river_alert_message(
        station_id, station_name, district, lat, lng, water_level, alert_level, trend
    )
    await publish_map(message)


async def broadcast_curfew_update(
    curfew_id: str,
    district: str,
    status: str,
    polygon: list,
    start_time: str,
    end_time: str,
    reason: str,
):
    """Broadcast a curfew zone update to all subscribed map clients."""
    message = create_curfew_update_message(
        curfew_id, district, status, polygon, start_time, end_time, reason
    )
    await publish_map(message)


async def broadcast_incident(
    incident_id: str,
    title: str,
    category: str,
    severity: str,
    lat: float,
    lng: float,
    district: str,
    source: str,
    story_id: str = None,
):
    """Broadcast a new incident marker to all subscribed map clients."""
    message = create_incident_marker_message(
        incident_id, title, category, severity, lat, lng, district, source, story_id
    )
    await publish_map(message)


async def broadcast_seismic_event(
    event_id: str,
    magnitude: float,
    depth_km: float,
    lat: float,
    lng: float,
    location: str,
    event_time: str,
):
    """Broadcast a seismic event to all subscribed map clients."""
    message = create_seismic_event_message(
        event_id, magnitude, depth_km, lat, lng, location, event_time
    )
    await publish_map(message)


# ============================================================================
# Stats Endpoint
# ============================================================================


@router.get("/ws/map/stats")
async def get_websocket_stats(
    _=Depends(require_dev),
):
    """Get WebSocket connection statistics."""
    return {
        "active_connections": len(manager.active_connections),
        "clients": [
            {
                "client_id": meta.get("client_id"),
                "connected_at": meta.get("connected_at"),
                "subscriptions": list(meta.get("subscriptions", [])),
            }
            for meta in manager.connection_metadata.values()
        ],
    }
