# Steps to run this project

## 1. Cài `uv` (quản lý Python cho `vispeller`)

### Linux / macOS

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Windows PowerShell

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Sau khi cài xong, kiểm tra:

```powershell
uv --version
```

---

## 2. Chạy Vispeller

Mở **terminal riêng**, tại thư mục `ERP`:

### Linux / macOS

```bash
cd vispeller
uv sync
uv run uvicorn api:app --reload --port 8000
```

### Windows PowerShell

```powershell
cd vispeller
uv sync
uv run uvicorn api:app --reload --port 8000
```

Vispeller sẽ chạy tại:

```text
http://localhost:8000
```

---

## 3. Chạy Backend ERP

Mở **terminal riêng**, tại thư mục `ERP`:

### Linux / macOS

```bash
npm ci
npm run dev
```

### Windows PowerShell

```powershell
npm ci
npm run dev
```

---

## 4. Tóm tắt các terminal

### Terminal 1 — Vispeller

```powershell
cd ERP\vispeller
uv sync
uv run uvicorn api:app --reload --port 8000
```

### Terminal 2 — Backend ERP

```powershell
cd ERP
npm ci
npm run dev
```
