import { criarApp } from "./app.js";
import { migrar } from "./migrate.js";
import { iniciarIndicePncp } from "./pncp-indice.js";

const porta = Number(process.env.PORT ?? 3000);
await migrar();
criarApp().listen(porta, () => {
  console.log(`Licita em http://localhost:${porta}`);
});
iniciarIndicePncp();
