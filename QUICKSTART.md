# Quick Start Guide

## 🎯 One-Command Deploy

### Pre-flight Check
```bash
npm run pre-deploy
```

### Docker
```bash
docker-compose up -d
# Access: http://localhost:8080
```

### Vercel
```bash
vercel --prod
```

## 🧪 Testing

### Test Ship Models
```bash
npm run verify:ships
```

### Test in Browser
```bash
npm run dev
# Open: http://localhost:5174/test-models.html
```

## 🔧 Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 📦 What's Fixed

✅ Ship GLB/GLTF models now load properly  
✅ Proper MIME types configured  
✅ CORS headers for 3D models  
✅ Optimized for Docker & Vercel  
✅ Build includes all model files  

## 🚢 Ship Models

- **Small Ships** (3MB GLTF) - Vessel detections
- **Silja Serenade** (3.8MB GLB) - Lucky Seven casino
- **MS Gabriella** (2.9MB GLB) - Pride of Goa II casino
- **Fishing Vessel** (104MB DAE) - Pride of Goa casino

## 📁 Key Files

- `vite.config.js` - Build configuration
- `nginx.conf` - Docker web server config
- `vercel.json` - Vercel deployment config
- `Dockerfile` - Container definition
- `docker-compose.yml` - Quick Docker setup

## 🐛 Troubleshooting

### Models not loading?
1. Run `npm run verify:ships`
2. Check browser console (F12)
3. Look for 404 errors in Network tab
4. Rebuild: `npm run build`

### Docker issues?
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Vercel issues?
1. Check deployment logs
2. Verify all files uploaded
3. Test locally with `npm run preview`

## 📚 Documentation

- `DEPLOYMENT.md` - Full deployment guide
- `SHIP_MODELS_FIX.md` - Technical details
- `/test-models.html` - Browser test page

## 🎉 Quick Test

After deployment, visit:
- Main app: `/`
- Model test: `/test-models.html`

Look for ships in the 3D scene!
