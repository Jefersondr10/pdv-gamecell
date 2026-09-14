export function createExpenseFilterController({
 apply,
 isBusy,
 setBusy,
 onError=()=>{},
 onSuccess,
 isCurrent=()=>true,
 snapshot=form=>Object.fromEntries(new FormData(form)),
 normalize=(_form,data)=>data,
 schedule=(callback,delay)=>setTimeout(callback,delay),
 cancel=timer=>clearTimeout(timer),
 retryDelay=40
}) {
 let pending=null,running=false,timer=null,generation=0;

 function stopTimer() {
  if(timer!==null)cancel(timer);
  timer=null;
 }

 function scheduleDrain(delay) {
  stopTimer();
  timer=schedule(()=>{timer=null;void drain();},delay);
 }

 async function drain() {
  if(running||!pending)return;
  if(!isCurrent(pending.form,pending.data)){pending=null;return;}
  if(isBusy()){scheduleDrain(retryDelay);return;}
  const intent=pending;
  pending=null;
  running=true;
  setBusy(true);
  try {
   await apply(intent.form,intent.data);
   if(intent.generation===generation&&isCurrent(intent.form,intent.data))onSuccess?.(intent.form,intent.data,intent.focusName);
  } catch(error) {
   if(intent.generation===generation)onError(error,intent.form);
  } finally {
   running=false;
   setBusy(false);
   if(pending&&timer===null)void drain();
  }
 }

 function request(form,{delay=0,focusName=''}={}) {
  if(!form||form.isConnected===false)return false;
  let data;
  try {
   data={...snapshot(form)};
   normalize(form,data);
  } catch(error) {
   generation++;
   pending=null;
   stopTimer();
   onError(error,form);
   return false;
  }
  if(!isCurrent(form,data))return false;
  pending={form,data,focusName,generation:++generation};
  if(delay>0)scheduleDrain(delay);
  else {stopTimer();void drain();}
  return true;
 }

 function clear() {
  generation++;
  pending=null;
  stopTimer();
 }

 return {request,clear};
}
