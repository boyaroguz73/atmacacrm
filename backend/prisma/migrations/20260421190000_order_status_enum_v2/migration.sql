-- Migration: OrderStatus enum genişletme
-- PENDING → AWAITING_PAYMENT, PROCESSING → PREPARING, DELIVERED → COMPLETED
-- Yeni: AWAITING_CHECKOUT ekleniyor

-- PostgreSQL 10+ destekli: RENAME VALUE mevcut satırları otomatik taşır
ALTER TYPE "OrderStatus" RENAME VALUE 'PENDING'     TO 'AWAITING_PAYMENT';
ALTER TYPE "OrderStatus" RENAME VALUE 'PROCESSING'  TO 'PREPARING';
ALTER TYPE "OrderStatus" RENAME VALUE 'DELIVERED'   TO 'COMPLETED';

-- Yeni durum: sepet terk (henüz tamamlanmadı)
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_CHECKOUT';
