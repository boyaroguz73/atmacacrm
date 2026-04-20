-- T-Soft getOrders ham yanıtını saklamak için JSON kolon.
ALTER TABLE "sales_orders" ADD COLUMN "siteOrderData" JSONB;
