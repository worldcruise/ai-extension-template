 function exportToFile() {
    var date = new Date();
    var day = ("0"+date.getDate()).slice(-2);
    var monthIndex = ("0"+(date.getMonth()+1)).slice(-2);
    var year = date.getFullYear();


   // downloadFileFromText('HighlightThis'+year+monthIndex+day, JSON.stringify(HighlightsData));
    backupObj=Settings;
    backupObj.groups=HighlightsData
    downloadObjectAsJson(backupObj,'HighlightThis'+year+monthIndex+day,function(){})
}

function downloadObjectAsJson(exportObj, exportName, callback){
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
    var downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", exportName );
    downloadAnchorNode.innerHTML=getLiteral("download_backup");
    var parentEl=document.getElementById("exportLinkDownload");
    parentEl.innerHTML='';
    parentEl.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    //downloadAnchorNode.remove();
    notify.backupCompleted();
    callback();
  }

function readFile(callback){
    var file = document.getElementById('importFile').files[0];
    var reader = new FileReader();


    reader.onload = function(evt){
        var fileString = evt.target.result;
        var tempObj= JSON.parse(fileString);
        callback(tempObj);
    };
    reader.readAsText(file, "UTF-8");
    return true;
}
function analyzeInputFile(evt){
    document.getElementById("importSyncFileLink").style.display='none';
    document.getElementById("importLocalFileLink").style.display='none';
    document.getElementById("hintRestore").style.display='none';

    readFile(function(tempObj){
        var countSync=0; var countLocal=0;
        //var isPreV3=preV3Backup(tempObj)

        if(tempObj.Version){
            backupObj=tempObj.Groups
        }
        else {
            if(tempObj.version){
                backupObj=tempObj.groups;
            }
            else {
                //pre v3 migration
                backupObj=tempObj;
            }

            
        }
       // if (isPreV3) {backupObj=tempObj.Groups;} else {backupObj=tempObj.groups;}
        for (group in backupObj){
            backupObj[group].storage=='sync'?countSync+=1:countLocal+=1;
            
            
        }
        if (countSync>0){
            document.getElementById("importSyncFileLink").innerHTML=getLiteral("importSyncRules").format(countSync);
            document.getElementById("importSyncFileLink").style.display='block';
            document.getElementById("hintRestore").style.display='block';
            document.getElementById("importSyncFileLink").addEventListener('click', function (e) {
                e.preventDefault();
                restoreBackup('sync');
                return false;
            });

        }
        if (countLocal>0){
            document.getElementById("importLocalFileLink").innerHTML=getLiteral("importLocalRules").format(countLocal);
            document.getElementById("importLocalFileLink").style.display='block';
            document.getElementById("hintRestore").style.display='block';
            document.getElementById("importLocalFileLink").addEventListener('click', function (e) {
                e.preventDefault();
                restoreBackup('local');
                return false;
            });
        }
        
    });
    //reader.readAsText(file, "UTF-8");

}

function restoreBackup(storage) {

    readFile(function(fileObj){

        //Check if it is a prev3MigrationBackup which lacks version/Version groups/Groups
        if(!fileObj.version && !fileObj.Version && !fileObj.groups && ! fileObj.Groups){
            var tempObj ={Groups:fileObj}
            tempObj.Version="20";
        }
        else {
            var tempObj=fileObj;
        }

        for(var group in tempObj.Groups){
            if (tempObj.Groups[group].storage!=storage){
                delete tempObj.Groups[group];
            }
        }
        chrome.runtime.sendMessage({command: "upgradeFromPreV3", data: tempObj, type: storage}, function (result) {

            //Debug&&console.log(result);
            backup=result.upgraded;

            if (storage=='local'){
                chrome.storage.local.clear(function(){
                    var settings={
                        donate: backup.donate,
                        enabled: backup.enabled,
                        performanceSetting: backup.performanceSetting,
                        printHighlights: backup.printHighlights,
                        showFoundWords: backup.showFoundWords,
                        version: backup.version,
                        neverHighlightOn: backup.neverHighlightOn,
                        license: backup.license,
                        installId: backup.installId
                    }
                    if(backup.backup){settings.backup=backup.backup}
                    chrome.storage.local.set({['Settings']:settings},function(){
                        restoreGroups(storage, backup);
                    });
                });
            }
            else {
                chrome.storage.sync.clear(function(){
                        restoreGroups(storage, backup);
                })
            }


        });
    })  
}

function restoreGroups(storage,  backup){
    // Define an array of Promises
    const promises = [];
    for (var group in backup.groups) {
        if(backup.groups[group].storage==storage){
            const promise = new Promise((resolve) => {
                restoreGroup(storage, group, backup.groups[group], resolve);
            });
            promises.push(promise);
            Promise.all(promises).then(() => {
                //console.log('Finished processing all objects');
                getLists(function(){
                    //drawInterface();
                    notify.restoreCompleted();
                    onPage();
                    closeSettings();

                });
            
            });       
        }
    }
}

function restoreGroup(storage, groupId, group, callback) {
    chrome.storage[storage].set({[groupId]:group},function(){
        callback();
    });
}

function preV3Backup (backupObj){
    if (backupObj.Version){
        return true;
    }
    return false;
}


function resetAll(){
    window.alert('resetting')
}