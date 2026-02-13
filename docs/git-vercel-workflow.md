# Git + Vercel (chuleta rapida)

## Idea clave
- `localhost:3000` muestra cambios locales.
- `git push` sube cambios a GitHub.
- Vercel despliega automaticamente lo que subes a `main` (Production).

## Flujo normal para subir cambios a la web
1. Ver estado:
```powershell
git status
```

2. Preparar archivos para commit (`git add`):
```powershell
git add .
```
o solo archivos concretos:
```powershell
git add app/chat/page.tsx
```

3. Crear commit:
```powershell
git commit -m "descripcion corta del cambio"
```

4. Subir a GitHub:
```powershell
git push
```

5. Verificar deploy:
- Ir a Vercel -> `Deployments`
- Debe aparecer un deployment nuevo en `main` con estado `Production`

## Que es `git add`
- Selecciona que archivos entran en el proximo commit.
- Sin `git add`, `git commit` no incluye esos cambios.

## Comandos utiles
Ver cambios no preparados:
```powershell
git status
```

Ver historial reciente:
```powershell
git log --oneline -5
```

## Nota importante
- La carpeta `tmp/` esta ignorada y no se sube (capturas del portapapeles).
