# LIA Coach  
## Contexto base para Codex CLI – v1

Este documento debe leerse y respetarse antes de cualquier cambio de código propuesto por Codex.

---

## 1. Resumen del producto

LIA Coach es una web app interactiva tipo app, pensada para uso diario continuo.  
No es una web informativa ni estática.

---

## 2. Principios no negociables

- Cero culpa y cero castigo.
- La app sugiere, el usuario decide.
- Adaptación al contexto del usuario.
- Rapidez y fluidez por encima de perfección técnica.
- Menos fricción siempre es mejor.

---

## 3. Modelo de aplicación

- LIA Coach es client-first.
- Las páginas principales son interactivas.
- Si una página tiene interacción, debe ser Client Component.
- Evitar comportamientos ambiguos.

---

## 4. Modelo de interacción

- Entrada principal por texto libre y voz con transcripción.
- No exigir formatos rígidos.
- Permitir anotaciones rápidas.
- Refinar datos más tarde si es necesario.

---

## 5. Flujo diario

- Identificación automática del día.
- Registro libre durante el día.
- Cierre de día recomendado, no obligatorio.
- Días sin datos son normales.

---

## 6. Comportamiento de la IA

La IA debe:
- sugerir, no imponer,
- explicar el porqué de los cálculos,
- priorizar patrones,
- callar cuando no aporta valor.

Nunca debe:
- juzgar,
- alarmar sin base,
- imponer decisiones.

---

## 7. Reglas funcionales clave

- Estimaciones conservadoras.
- Diferenciar crudo vs cocido.
- Separar metabolismo basal, NEAT y ejercicio.
- No compensar errores pasados.
- Priorizar proteína.
- Permitir hidratos según actividad.
- No demonizar alimentos.

---

## 8. Salud

- Detectar señales de alerta relevantes.
- Priorizar descanso e hidratación.
- No sustituir diagnóstico médico.

---

## 9. Uso obligatorio por Codex

Antes de proponer cambios, Codex debe:
- leer este documento,
- respetar los otros documentos del proyecto,
- proponer cambios mínimos y coherentes.

Si algo funciona técnicamente pero rompe la experiencia definida aquí, está mal.
