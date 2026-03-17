# Sử dụng Node.js LTS làm base image
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files (including lock file if exists)
COPY package*.json ./

# Cài đặt dependencies (bỏ qua scripts để tránh tsc chạy sớm khi chưa có code)
RUN npm install --ignore-scripts

# Copy toàn bộ source code
COPY . .

# Build TypeScript (tsc sẽ chạy ở đây)
RUN npm run build

# Stage 2: Runner
FROM node:20-alpine

WORKDIR /app

# Copy package files và install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

# Copy các file cần thiết từ stage builder
# Lưu ý: tsconfig.json cấu hình outDir là build/
COPY --from=builder /app/build ./build

# Mở port (App index.ts dùng port 3000)
EXPOSE 3000

# Lệnh khởi chạy chính thức
CMD ["node", "build/index.js"]
