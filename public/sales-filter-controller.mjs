import { normalizeDateFields, salesFilterValues } from './date-control.mjs';

// Capture the user's selection before apply() disables or replaces its form.
export function createSalesFilterController({
 apply, isBusy, setBusy, today, onError = () => {}, onSuccess,
 isCurrent = () => true,
 snapshot = form => Object.fromEntries(new FormData(form)),
 schedule = (callback, delay) => setTimeout(callback, delay),
 cancel = timer => clearTimeout(timer)
}) {
 let pending = null, running = false, timer = null, generation = 0;

 function stopTimer() {
  if (timer !== null) cancel(timer);
  timer = null;
 }

 function retry() {
  if (timer !== null || !pending || running) return;
  timer = schedule(() => { timer = null; void drain(); }, 40);
 }

 async function drain() {
  if (running || !pending) return;
  if (!isCurrent(pending.form, pending.data)) { pending = null; return; }
  if (isBusy()) { retry(); return; }
  const intent = pending;
  pending = null;
  running = true;
  setBusy(true);
  try {
   await apply(intent.data);
   if (intent.generation === generation && isCurrent(intent.form, intent.data)) onSuccess?.(intent.form, intent.data);
  } catch (error) {
   if (intent.generation === generation) onError(error);
  } finally {
   running = false;
   setBusy(false);
   retry();
  }
 }

 function request(form, { automatic = false } = {}) {
  if (!form || form.isConnected === false) return false;
  let data;
  try {
   data = { ...snapshot(form) };
   normalizeDateFields(form, data);
   salesFilterValues(data, today());
  } catch (error) {
   // An unfinished replacement must not leave an older queued range to apply.
   pending = null;
   stopTimer();
   if (!automatic || data?.date_preset !== 'period') onError(error);
   return false;
  }
  if (!isCurrent(form, data)) return false;
  pending = { form, data, generation };
  stopTimer();
  void drain();
  return true;
 }

 function clear() {
  generation++;
  pending = null;
  stopTimer();
 }

 return { request, clear };
}
