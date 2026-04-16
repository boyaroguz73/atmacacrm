FROM node:20-alpine AS builder

WORKDIR /app

# Prisma + sharp için gerekli bağımlılıklar (Alpine)
RUN apk add --no-cache openssl libc6-compat python3 make g++ vips-dev

# Sharp source build için node-gyp gerekli
RUN npm install -g node-gyp

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install --include=optional

COPY . .
RUN npm run build

FROM node:20-alpine

# Runtime için gerekli: openssl, libc6-compat, vips (sharp için), fontlar (PDF için)
RUN apk add --no-cache openssl libc6-compat vips ttf-dejavu

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

# DejaVu fontlarını PDFKit için erişilebilir konuma kopyala
RUN mkdir -p /app/fonts && \
    cp /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf /app/fonts/ 2>/dev/null || \
    cp /usr/share/fonts/dejavu/DejaVuSans.ttf /app/fonts/ 2>/dev/null || \
    find /usr/share/fonts -name "DejaVuSans.ttf" -exec cp {} /app/fonts/ \; 2>/dev/null || true

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
