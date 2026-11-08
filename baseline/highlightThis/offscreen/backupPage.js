chrome.runtime.onMessage.addListener(handleMessages);

// This function performs basic filtering and error checking on messages before
// dispatching the
// message to a more specific message handler.
async function handleMessages(message) {
  // Return early if this message isn't meant for the offscreen document.
  if (message.target !== 'offscreen') {
    return;
  }

  // Dispatch the message to an appropriate handler.
  switch (message.type) {
    case 'backup':
      saveBackup(message.data);
      break;
    default:
      console.warn(`Unexpected message type received: '${message.type}'.`);
  }
}

function saveBackup(backupObj){
    var date = new Date();
    var day = ("0"+date.getDate()).slice(-2);
    var monthIndex = ("0"+(date.getMonth()+1)).slice(-2);
    var year = date.getFullYear();
    downloadObjectAsJson(backupObj,'HighlightThis'+year+monthIndex+day)
}


function downloadObjectAsJson(exportObj, exportName){
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
    var downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", exportName );
    downloadAnchorNode.innerHTML='Download backup';
    var parentEl=document.getElementById("exportLinkDownload");
    parentEl.innerHTML='';
    parentEl.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    
  }

  