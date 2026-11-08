console.info('HighlightThis Upgrade - upgrading localstorage from v5 to v6');

window.onerror = function (message, source, lineno, colno, error) {
    console.error("Error occurred:", message);
    console.error("Source:", source);
    console.error("Line:", lineno);
    console.error("Column:", colno);
    console.error("Error object:", error);
    chrome.storage.session.get({ errors: [] }, function (data) {
        const { errors } = data;
    
        // Add the new error to the existing errors array
        errors.push({ message: message,  source: source, line: lineno, col:colno, error: error.stack });
    
        const maxErrorsToKeep = 50;
        const errorsToStore = errors.slice(-maxErrorsToKeep);

        // Store the updated errors array back in chrome.storage.session
        chrome.storage.session.set({ errors: errorsToStore }, function () {
          if (chrome.runtime.lastError) {
            console.error("Error storing errors:", chrome.runtime.lastError);
          } else {
            console.log("Error stored successfully.");
          }
        });
    });
    return true; // Prevents the default browser error handling (e.g., showing an error dialog).
};


var tasksToDo=4;
var maxRunTime=60000;
var runTime=1000;
document.getElementById("btnMigrate").addEventListener("click", function(){migrate()});
document.getElementById("btnDownload").addEventListener("click", function(){download()});
document.getElementById("fixTransformationIssue").addEventListener("click", function(){fixAfterMigration()});
function upgradeLocalStorage() {
    if(localStorage.HighlightsData) {
        var HighlightsData=JSON.parse(localStorage.HighlightsData);

        console.info('HighlightThis Upgrade - upgrade schema to latest version')
        HighlightsData=upgradeVersion(HighlightsData, 'local', false, false)

        tasksToDo += Object.keys(HighlightsData.Groups).length;

        chrome.storage.local.clear(function(e){console.info(e)})
        for (var highlightData in HighlightsData.Groups) {
            console.info('HighlightThis Upgrade - processing ' + highlightData)
            chrome.storage.local.set({[uuidv4()]:HighlightsData.Groups[highlightData]},function(){});
            delete HighlightsData.Groups[highlightData];
            tasksToDo-=1;
        }
        delete HighlightsData.Groups;
        chrome.storage.local.set({Settings:HighlightsData},function(){});
        tasksToDo-=1;
    }
}

function upgradeSyncStorage() {

    
    chrome.storage.sync.get(function(highlightsData){
        console.log(highlightsData);
        if(highlightsData.Settings && !highlightsData.Settings.version && highlightsData.Settings.Version!=21){
            console.info('HighlightThis Upgrade - upgrade schema to latest version');
            highlightsData=upgradeVersion({Version: highlightsData.Settings.Version, Groups: highlightsData}, 'sync', false, false)
            console.info('HighlightThis Upgrade - upgraded schema', highlightsData);
            chrome.storage.sync.clear(function(){
                chrome.storage.sync.set({"Settings":{"version":highlightsData.version}},function(){tasksToDo+=-1});
                
                for(group in highlightsData.Groups){
                    tasksToDo+=1
                    chrome.storage.sync.set({[uuidv4()]:highlightsData.Groups[group]},function(){tasksToDo+=-1});
                } 
            });
        }
        else {
            tasksToDo+=-1
            console.info('HighlightThis Upgrade - sync storage is already upgraded or is not used');
        }

    });
}

function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

function upgradeVersion(inData, type, backupBeforeUpgrade, forceSave){

    var upgraded=false;
    var latestVersion="21";

    if(type=="sync"){
        delete inData.Groups.Settings;
    } //avoids upgrading settings
    if(Number(inData.Version)<latestVersion){        
        backupBeforeUpgrade && backup(inData, inData.Version, type);
        upgraded=true;
    }
    if (inData.Version=="2") {
        //upgrade from v2
        for (var highlightData in inData.Groups) {
            inData.Groups[highlightData].Enabled=true;
            inData.Groups[highlightData].FindWords=true;
            inData.Groups[highlightData].Fcolor="#000";
            inData.Groups[highlightData].ShowOn=[];
            inData.Groups[highlightData].DontShowOn=[];
        }
        type=='local' && (inData.ShowFoundWords=true);
        type=='local' && (inData.neverHighlightOn=[]);
        inData.Version="6";
    }
    if (inData.Version=="3") {
        //upgrade from v3
        for (var highlightData in inData.Groups) {
            inData.Groups[highlightData].FindWords=true;
            inData.Groups[highlightData].Fcolor="#000";
            inData.Groups[highlightData].ShowOn=[];
            inData.Groups[highlightData].DontShowOn=[];
        }
        type=='local' && (inData.ShowFoundWords=true);
        type=='local' && (inData.neverHighlightOn=[]);
        inData.Version="6";
    }
    if (inData.Version=="4") {
        //upgrade from v4
        for (var highlightData in inData.Groups) {
            inData.Groups[highlightData].Fcolor="#000";
            inData.Groups[highlightData].ShowOn=[];
            inData.Groups[highlightData].DontShowOn=[];
        }
        type=='local' && (inData.ShowFoundWords=true);
        type=='local' && (inData.neverHighlightOn=[]);
        inData.Version="6";

    }
    if (inData.Version=="5") {
        //upgrade from v4
        for (var highlightData in inData.Groups) {
            inData.Groups[highlightData].DontShowOn=[];
        }
        type=='local' && (inData.neverHighlightOn=[]);
        inData.Version="6";
    }
    if (inData.Version=="6"){
        //convert words to array
        for (var highlightData in inData.Groups) {
            var arr = Object.keys(inData.Groups[highlightData].Words).map(function(k) { return k});
            inData.Groups[highlightData].Words=arr;
            inData.Groups[highlightData].Modified=Date.now();
        }
        inData.Version="7";
    }
    if (inData.Version=="7"){
        type=='local' && (inData.PrintHighlights=true);
        inData.Version="8";
    }
    if (inData.Version=="8"){
        for (var highlightData in inData.Groups) {
            inData.Groups[highlightData].Type='local';
        }
        inData.Version="9";
    }
    if (inData.Version=="9"||inData.Version=="10"){
        for (var highlightData in inData.Groups) {
            inData.Groups[highlightData].ShowInEditableFields=false;
        }
        inData.Version="11";
    }
    if (inData.Version=="11"){
        var today=new Date();
        type=='local' && (inData.Donate=today);            
        inData.Version="12";
    }
    if (inData.Version=="12"){
        type=='local' && (inData.PerformanceSetting=200);            
        inData.Version="13";
    }
    if (inData.Version=="13"){
        for (var highlightData in inData.Groups) {
            inData.Groups[highlightData].NotifyOnHighlight=false;
        }
        inData.Version="14";
    }
    if (inData.Version=="14"){
        for (var highlightData in inData.Groups) {
            inData.Groups[highlightData].NotifyFrequency=1;
            inData.Groups[highlightData].storage=type;
        }
        inData.Version="15";
    }
    if (inData.Version=="15"){
        for (var highlightData in inData.Groups) {
            inData.Groups[highlightData].regexTokens=false;
            inData.Groups[highlightData].caseSensitive=false;

        }
        inData.Version="16";
    }
    if (inData.Version=="16"|inData.Version=="17"){
        // fix for an issue due to a rollback on chrome and FF
        for (var highlightData in inData.Groups) {
            if(inData.Groups[highlightData].regexTokens==undefined){
                inData.Groups[highlightData].regexTokens=false;
                inData.Groups[highlightData].caseSensitive=false;
            }
        }
        inData.Version="18";
    }
    
    if (inData.Version=="18"){
        // add sync frequency to remote list config
        for (var highlightData in inData.Groups) {
            if(inData.Groups[highlightData].Type=='remote'){
                inData.Groups[highlightData].RemoteConfig.syncFrequency=240;
            }
        }
        inData.Version="19";
    }

    if (inData.Version=="19"){
        type=='local' && (inData.installId=uuidv4());
        inData.Version="20";
    }
    if (inData.Version=="20"){
        for (var highlightData in inData.Groups) {
            //force the right storage type
            if (!inData.Groups[highlightData].storage) inData.Groups[highlightData].storage=type;
            if (!inData.Groups[highlightData].color) inData.Groups[highlightData].color=inData.Groups[highlightData].Color;
            if (!inData.Groups[highlightData].dontShowOn) inData.Groups[highlightData].dontShowOn=inData.Groups[highlightData].DontShowOn;
            if (!inData.Groups[highlightData].enabled) inData.Groups[highlightData].enabled=inData.Groups[highlightData].Enabled;
            if (!inData.Groups[highlightData].fColor) inData.Groups[highlightData].fColor=inData.Groups[highlightData].Fcolor;
            if (!inData.Groups[highlightData].findWords) inData.Groups[highlightData].findWords=inData.Groups[highlightData].FindWords;
            if (!inData.Groups[highlightData].modified) inData.Groups[highlightData].modified=inData.Groups[highlightData].Modified;
            if (!inData.Groups[highlightData].notifyFrequency) inData.Groups[highlightData].notifyFrequency=inData.Groups[highlightData].NotifyFrequency;
            if (!inData.Groups[highlightData].notifyOnHighlight) inData.Groups[highlightData].notifyOnHighlight=inData.Groups[highlightData].NotifyOnHighlight;
            if (!inData.Groups[highlightData].showInEditableFields) inData.Groups[highlightData].showInEditableFields=inData.Groups[highlightData].ShowInEditableFields;
            if (!inData.Groups[highlightData].showOn) inData.Groups[highlightData].showOn=inData.Groups[highlightData].ShowOn;
            if (!inData.Groups[highlightData].type) inData.Groups[highlightData].type=inData.Groups[highlightData].Type;
            if (!inData.Groups[highlightData].words) inData.Groups[highlightData].words=inData.Groups[highlightData].Words;
            if (!inData.Groups[highlightData].remoteConfig) inData.Groups[highlightData].remoteConfig=inData.Groups[highlightData].RemoteConfig;
            if (!inData.Groups[highlightData].border) inData.Groups[highlightData].border=true;
            if (!inData.Groups[highlightData].bold) inData.Groups[highlightData].bold=false;
            if (!inData.Groups[highlightData].padding) inData.Groups[highlightData].padding=true;
            if (!inData.Groups[highlightData].radius) inData.Groups[highlightData].radius=true;
            if (!inData.Groups[highlightData].italic) inData.Groups[highlightData].italic=false;
            if (!inData.Groups[highlightData].underline) inData.Groups[highlightData].underline=false;
            if (!inData.Groups[highlightData].containerSelector) inData.Groups[highlightData].containerSelector='';

            if (!inData.Groups[highlightData].name) inData.Groups[highlightData].name=highlightData;

            delete inData.Groups[highlightData].Color;
            delete inData.Groups[highlightData].DontShowOn;
            delete inData.Groups[highlightData].Enabled;
            delete inData.Groups[highlightData].Fcolor;
            delete inData.Groups[highlightData].FindWords;
            delete inData.Groups[highlightData].Modified;
            delete inData.Groups[highlightData].NotifyFrequency;
            delete inData.Groups[highlightData].NotifyOnHighlight;
            delete inData.Groups[highlightData].ShowInEditableFields;
            delete inData.Groups[highlightData].ShowOn;
            delete inData.Groups[highlightData].Type;
            delete inData.Groups[highlightData].Words;
            delete inData.Groups[highlightData].RemoteConfig;
        }
        inData.version="21";

        inData.enabled=true;
        if(!inData.performanceSetting) inData.performanceSetting=inData.PerformanceSetting;
        if(!inData.printHighlights) inData.printHighlights=inData.PrintHighlights;
        if(!inData.showFoundWords) inData.showFoundWords=inData.ShowFoundWords;
        
        var today=new Date();
        inData.license= {
            type:'Temp',
            validUntil: today.setDate(today.getDate()+30)
        }

        delete inData.ShowFoundWords;
        delete inData.PrintHighlights;
        delete inData.PerformanceSetting;
        delete inData.Donate;
        delete inData.Version
    }
    return inData;
}

function downloadObjectAsJson(exportObj, exportName, storage){
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
    var downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", exportName );
    downloadAnchorNode.innerHTML= storage; //chrome.i18n.getMessage("download_backup");
    var parentEl=document.getElementById("divDownload"+storage);
    parentEl.innerHTML='';
    parentEl.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    tasksToDo-=1;
  }

function getBackup(storage, filename){
    if(storage=='local'){
        downloadObjectAsJson(JSON.parse(localStorage.HighlightsData), filename, storage)
    }
    else if (storage=='sync'){
        chrome.storage.sync.get(function(syncStorage){
            downloadObjectAsJson(syncStorage, filename, storage)
        })
    }
}


function migrate() {
    upgradeLocalStorage();
    upgradeSyncStorage();
}
function download() {
    getBackup('local', 'HighlightThisBackupBeforeV3Migration_local.txt');
    getBackup('sync', 'HighlightThisBackupBeforeV3Migration_sync.txt');
}

const urlParams = new URLSearchParams(window.location.search);

if(urlParams.get('action')=='execute'){
    document.getElementById("migrationBusyMessage").style.display="block";
    download();
    migrate() ;
    loopCheck();
}

function loopCheck(){
    if(runTime>=maxRunTime){
        document.getElementById("migrationBusyMessage").style.display="none";
        document.getElementById("migrationFailed").style.display="block";
        return;
    }
    setTimeout(function () {
        if(tasksToDo==0) {
            window.close();
        }
        runTime+=1000;
        loopCheck();
    }, 1000);
}


function fixAfterMigration(){
    
    //checks if there are any sync groups which are incorrectly transformed
    document.getElementById('feedbackFixTransformationIssue').innerHTML='Check if I need to fix sync groups<br/>';


    Promise.all([
       new Promise((resolve, reject) => chrome.storage.sync.get(result => resolve(result)))
    ]).then(([syncData]) => {
        const groups = Object.assign({}, syncData);
        if(groups.Settings.version=='21'){
            console.log(groups)
            for (var group in groups){
                    document.getElementById('feedbackFixTransformationIssue').innerHTML+='Checking Group ' + group + '<br/>';  
                    if(groups[group].storage=='sync' && groups[group].DontShowOn) {
                        document.getElementById('feedbackFixTransformationIssue').innerHTML+='Fixing Group ' + group + '<br/>';
                        console.log('deleting group', groups[group])
                        chrome.storage.sync.remove([group],function(){
                            fixTransformationIssue
                            document.getElementById('feedbackFixTransformationIssue').innerHTML+='Group ' + group + ' fixed <br/>';
                        });
                    }
            }
            
        }
        document.getElementById('feedbackFixTransformationIssue').innerHTML+='Done <br/>';
    });
}