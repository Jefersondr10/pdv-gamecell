import { parseMoneyInput } from './money.ts';

export function productEditorPayload(
  values: { model: string; color: string; memory: string; price: string },
  code: string,
  market: string,
) {
  return {
    model: values.model,
    color: values.color,
    memory: values.memory,
    defaultPriceCents: parseMoneyInput(values.price),
    ...(code.trim()
      ? { addCode: { code: code.trim(), market: market || null } }
      : {}),
  };
}
