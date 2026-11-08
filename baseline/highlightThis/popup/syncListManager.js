function updateGroupAfterSync(groupName, lastSync, words){


}

function showStatusMessage(containerId, message, success){
    document.getElementById(containerId).innerHTML=message;
    document.getElementById(containerId).style.display="initial";
    document.getElementById(containerId).className= (success?"statusSuccess":"statusError");
}

function extractGoogleSheetsIdFromURL(inUrl){
    //https://spreadsheets.google.com/feeds/list/' + id + '/' + sheet + '/public/values?alt=json
        //        inUrl.replace('https://docs.google.com/spreadsheets/d/e/2PACX-1vSD7aoej2FzcDnF97B0FPjnJhSHhbfPWakes8jGRs7k52F9My0EPjIIa0upqinKp9bIcv_g0JlowKw2/pubhtml?gid=0&single=true')
    
    if(inUrl.indexOf('https://docs.google.com/spreadsheets/d')==0){
        var parts=inUrl.split('/');
        if(parts[5].length>10) {
            return {result: true, id: parts[5]};
        }
        else {
            if(parts[5]=='e'&&parts[6].length>10){
                return {result: true, id: parts[6]};

            }
        }
    }
    return {result:false, message:'not a valid url'};
}

async function syncList(){
    Debug && console.log("Sync list");
    document.getElementById("syncLinkText").innerHTML=chrome.i18n.getMessage("synchronizing");
    document.getElementById('syncLink').disabled=true;
    
    remoteConfig=getRemoteConfig();
    chrome.runtime.sendMessage({command: "syncList",groupId:  document.getElementById("editWordsGroupId").value, remoteConfig: remoteConfig, save: false}, function (response) {
        document.getElementById("syncLinkText").innerHTML=chrome.i18n.getMessage("sync");
        document.getElementById('syncLink').disabled=false;
        if(response.success){
            wordsToEditor(response.words);

            var lastSync=new Date(response.lastUpdated);
            document.getElementById("syncStatusLastUpdated").innerText=lastSync.toLocaleString(); 
            //updateGroupAfterSync(document.getElementById("group").value, response.lastUpdated, response.words)
            HighlightsData[document.getElementById("editWordsGroupId").value].remoteConfig.lastUpdated=response.lastUpdated;
            showStatusMessage("syncStatusMessage", "Done", true)
        }
        else {
            showStatusMessage("syncStatusMessage", response.message, false)
        }

    });
}