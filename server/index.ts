import { criarApp } from "./app.js";
import { migrar } from "./migrate.js";

const porta = Number(process.env.PORT ?? 3000);
await migrar();
criarApp().listen(porta, () => {
  console.log(`Licita em http://localhost:${porta}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY não definida: as funções de IA ficarão indisponíveis.");
});
