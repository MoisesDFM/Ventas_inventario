# Pruebas de reglas de negocio

`reglas-negocio.test.js` ejecuta el backend `.gs` en Node usando `appsscript-mock.js`,
un doble de prueba de los servicios de Google (SpreadsheetApp, CacheService,
PropertiesService, LockService, Utilities). No requiere credenciales ni acceso a Drive.

```bash
node tests/reglas-negocio.test.js
```

Cubre: instalación de las 5 pestañas, login/hash SHA-256, RBAC por rol, segregación
por PDV y marca, ingreso de unidades, traslado en 2 pasos, venta con cálculo
automático de mes/semana/días en sala, reportes, auditoría y exportación CSV.
