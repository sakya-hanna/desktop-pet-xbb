'use strict';
function fromMainFrame(event,window){
 return !!(event && window && !window.isDestroyed() && window.webContents
  && !window.webContents.isDestroyed?.() && event.sender===window.webContents
  && event.senderFrame && event.senderFrame===window.webContents.mainFrame);
}
module.exports={fromMainFrame};
