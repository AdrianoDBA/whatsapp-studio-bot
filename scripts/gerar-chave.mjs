#!/usr/bin/env node
/**
 * Gera a chave de segurança do cofre (ENCRYPTION_KEY).
 *
 * PRA QUE SERVE
 * -------------
 * É com essa chave que o app tranca as chaves de API que você cadastra pelo
 * painel (OpenRouter, Anthropic, Resend...). Sem ela, o app se recusa a guardar
 * qualquer chave — de propósito: guardar segredo sem tranca é pior do que não
 * guardar.
 *
 * QUANDO VOCÊ PRECISA DISSO
 * -------------------------
 * Só na SUA MÁQUINA. No servidor (EasyPanel), o app já gera e imprime uma
 * chave pronta no registro (log) quando ela está faltando.
 *
 * COMO USAR
 *   npm run gerar-chave
 *
 * Copie a linha inteira e cole no seu arquivo `.env.local`. Depois reinicie o
 * `npm run dev`.
 *
 * ⚠️ GUARDE ESSA CHAVE. Se ela mudar, as chaves de API que você já cadastrou
 * pelo painel param de abrir e você vai ter que cadastrar de novo. Não é
 * perigoso — é chato.
 */

import { randomBytes } from "node:crypto";

// 32 bytes = 256 bits, escritos em base64. É exatamente o formato que o cofre
// aceita (ele recusa frase secreta inventada, que é fácil demais de adivinhar).
const chave = randomBytes(32).toString("base64");

console.log("");
console.log("  Cole esta linha no seu arquivo .env.local:");
console.log("");
console.log(`  ENCRYPTION_KEY=${chave}`);
console.log("");
console.log("  Depois reinicie o npm run dev.");
console.log("");
