const device=document.querySelector('[data-device-size]');
let actualSize=false;
function fitPhone(){
 const heights={compact:700,regular:844,large:932},widths={compact:320,regular:390,large:430};
 const size=device.dataset.deviceSize,available=window.innerHeight-document.querySelector('.preview-heading').offsetHeight-100;
 device.style.zoom=actualSize?'1':String(Math.min(1,Math.max(.5,available/(heights[size]+16)),(window.innerWidth-40)/(widths[size]+16)));
}
document.querySelector('.sizes').addEventListener('click',event=>{
 const button=event.target.closest('[data-size]');if(!button)return;
 device.dataset.deviceSize=button.dataset.size;
 for(const item of document.querySelectorAll('[data-size]'))item.setAttribute('aria-pressed',String(item===button));
 fitPhone();
 // Keep the same iframe, route, session and unfinished form.
});
window.addEventListener('resize',fitPhone);fitPhone();
document.querySelector('[data-preview-zoom]').addEventListener('click',event=>{actualSize=!actualSize;event.currentTarget.textContent=actualSize?'Enquadrar':'Ampliar';event.currentTarget.setAttribute('aria-pressed',String(actualSize));fitPhone();});
