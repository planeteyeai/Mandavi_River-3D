# Mandavi River 3D - Deployment Guide

This guide covers deploying the Mandavi River 3D visualization application using Docker or Vercel.

## 🚢 Ship Models

The application uses 3D ship models:

- **Small Ship Detection Model** (GLTF, 3MB) - For Sentinel-1 detected vessels
- **Silja Serenade** (GLB, 3.83MB) - Casino ship "Lucky Seven"
- **MS Gabriella** (GLB, 2.86MB) - Casino ship "Pride of Goa II"
- **Fishing Vessel VII** (DAE, 104MB) - Casino ship "Pride of Goa"

### Verify Models Before Deployment

```bash
npm run verify:ships
```

## 🐳 Docker Deployment

### Build and Run

```bash
# Build the image
docker build -t mandavi-river .

# Run the container
docker run -p 8080:80 mandavi-river

# Or use docker-compose
docker-compose up -d
```

### Access

Open http://localhost:8080 in your browser.

### Production Tips

- Image size: ~30MB (Alpine + Nginx)
- Models are bundled during build
- Gzip compression enabled
- Proper MIME types for 3D models configured

## ▲ Vercel Deployment

### Quick Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to production
vercel --prod
```

### Via Dashboard

1. Connect your GitHub/GitLab repository
2. Vercel auto-detects Vite configuration
3. Deploy automatically on push

### Configuration

The `vercel.json` includes:

- API proxy routes for backend services
- CORS headers for 3D models
- Proper cache headers (1 year for assets, 7 days for data)
- SPA routing support

## 🔧 Build Configuration

### Vite Config

The app is configured to:

- Include `.glb`, `.gltf`, `.dae` files as assets
- Disable asset inlining for proper model loading
- Organize models in dedicated directory
- Support large chunk sizes (up to 1600KB)

### Asset Handling

- **GLB/GLTF files in `src/`**: Bundled by Vite, get hashed filenames
- **Files in `public/`**: Served as-is, keep original paths
- All 3D models are automatically discovered and loaded

## 📦 File Structure

```
Mandavi_River-3D/
├── public/
│   └── data/
│       ├── fishing-vessel-vii/
│       │   └── Fishing Vessel VII.dae
│       └── mandovi/
│           └── Ships/
│               └── Small_Ships/source/model.gltf
├── src/
│   ├── data/
│   │   ├── silja-line-ms-silja-serenade-1990/source/SiljaSerenade.glb
│   │   └── viking-line-ms-gabriella-19922016/source/Gabriella2016.glb
│   └── eye/
│       └── scene/
│           ├── shipsLayer.js
│           └── casinoShipsLayer.js
```

## 🐛 Troubleshooting

### Ships Not Loading

1. **Check browser console** for 404 errors
2. **Verify model files exist**:
   ```bash
   npm run verify:ships
   ```
3. **Check CORS headers** in Network tab
4. **Clear browser cache** and rebuild:
   ```bash
   rm -rf dist node_modules/.vite
   npm install
   npm run build
   ```

### Build Errors

If you see "asset too large" warnings:

- These are warnings, not errors
- The app will still work
- Models are loaded on-demand, not blocking initial load

### Docker Issues

If models don't load in Docker:

1. **Rebuild with no cache**:
   ```bash
   docker build --no-cache -t mandavi-river .
   ```
2. **Check nginx logs**:
   ```bash
   docker logs <container-id>
   ```

## 🚀 Performance

- **Initial load**: ~500KB (without models)
- **Models load on-demand**: 10-110MB total
- **Gzip reduces transfer** by ~70%
- **Browser caching** after first load

## 📝 Development

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🔒 Security

- CSP headers configured
- CORS restricted to models only
- No credentials in public files
- API keys proxied through backend

## 📊 Monitoring

### Health Checks

Docker includes healthcheck:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:80/"]
  interval: 30s
  timeout: 3s
  retries: 3
```

### Logs

- **Docker**: `docker logs mandavi-river-3d`
- **Vercel**: Check deployment logs in dashboard

## 🌐 Environment Variables

No environment variables required for deployment. API endpoints are configured in:

- `vite.config.js` (dev proxy)
- `nginx.conf` (Docker production)
- `vercel.json` (Vercel production)

## 📚 Additional Resources

- [Vite Documentation](https://vitejs.dev/)
- [Docker Documentation](https://docs.docker.com/)
- [Vercel Documentation](https://vercel.com/docs)
- [Three.js GLTFLoader](https://threejs.org/docs/#examples/en/loaders/GLTFLoader)
