import { parseProductPriceInput } from './product-prices.ts';

type ProductFields = {
  model: string;
  color: string;
  memory: string;
  defaultPriceCents: number;
};

export function productEditorPayload(
  values: { model: string; color: string; memory: string; price: string },
  code: string,
  market: string,
  baseline?: ProductFields | null,
) {
  const fields: ProductFields = {
    model: values.model.trim(),
    color: values.color.trim(),
    memory: values.memory.trim(),
    defaultPriceCents: parseProductPriceInput(values.price, !baseline),
  };
  const changed = baseline
    ? Object.fromEntries(
        Object.entries(fields).filter(
          ([key, value]) => baseline[key as keyof ProductFields] !== value,
        ),
      )
    : fields;
  return {
    ...changed,
    ...(baseline && Object.keys(changed).length
      ? {
          expected: Object.fromEntries(
            Object.keys(changed).map((key) => [
              key,
              baseline[key as keyof ProductFields],
            ]),
          ),
        }
      : {}),
    ...(code.trim()
      ? { addCode: { code: code.trim(), market: market || null } }
      : {}),
  };
}
