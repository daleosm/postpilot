from fastapi import APIRouter

from app.api.routes import (
    approvals,
    auth,
    billing,
    bookings,
    budget,
    catering,
    client_purchase_orders,
    crm,
    dashboard,
    debug,
    deliveries,
    episodes,
    health,
    organizations,
    purchase_orders,
    qc,
    rate_cards,
    settings,
    shows,
    vendor_invoices,
    work_orders,
)

api_router = APIRouter(prefix="/v1")
api_router.include_router(auth.router)
api_router.include_router(approvals.router)
api_router.include_router(debug.router)
api_router.include_router(organizations.router)
api_router.include_router(dashboard.router)
api_router.include_router(bookings.router)
api_router.include_router(budget.router)
api_router.include_router(billing.router)
api_router.include_router(client_purchase_orders.router)
api_router.include_router(crm.router)
api_router.include_router(work_orders.router)
api_router.include_router(purchase_orders.router)
api_router.include_router(vendor_invoices.router)
api_router.include_router(rate_cards.router)
api_router.include_router(deliveries.router)
api_router.include_router(qc.router)
api_router.include_router(catering.router)
api_router.include_router(settings.router)
api_router.include_router(shows.router)
api_router.include_router(episodes.router)

root_router = APIRouter()
root_router.include_router(health.router)
