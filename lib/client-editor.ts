type ClientFields = {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

export function clientEditorPayload(
  values: { name: string; phone: string; email: string; notes: string },
  baseline: ClientFields,
) {
  const next: ClientFields = {
    name: values.name.trim(),
    phone: values.phone.trim() || null,
    email: values.email.trim().toLowerCase() || null,
    notes: values.notes.trim() || null,
  };
  const changed = Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) => baseline[key as keyof ClientFields] !== value,
    ),
  );
  if (!Object.keys(changed).length) return {};
  return {
    ...changed,
    expected: Object.fromEntries(
      Object.keys(changed).map((key) => [
        key,
        baseline[key as keyof ClientFields],
      ]),
    ),
  };
}
