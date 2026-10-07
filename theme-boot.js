/* AI Bridge v5.9 theme bootstrap: runs before the stylesheet paints so the
   chosen light/dark theme never flashes. "auto" follows the OS setting. */
(function(){
  "use strict";
  var theme="auto";
  try{theme=localStorage.getItem("ai_bridge_theme")||"auto"}catch(e){}
  if(theme!=="light"&&theme!=="dark")theme="auto";
  document.documentElement.setAttribute("data-theme",theme);
  /* v5.11.50: доступність — застосувати до першого рендера, щоб не блимало. */
  try{
    var a=JSON.parse(localStorage.getItem("ai_bridge_a11y_v1")||"{}")||{};
    if(a.dyslexic)document.documentElement.classList.add("a11yDyslexic");
    var s=["m","l","xl"].indexOf(a.size)>=0?a.size:"m";
    document.documentElement.setAttribute("data-a11y-size",s);
  }catch(e){}
})();
