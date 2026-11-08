String.prototype.format = function() {
    a = this;
    for (k in arguments) {
      a = a.replace("{" + k + "}", arguments[k])
    }
    return a
  }




document.addEventListener('DOMContentLoaded', function () {

    document.getElementById('importFile').addEventListener('change',function(){
        analyzeInputFile();
    });
    document.getElementById("restoreWarning").innerHTML = chrome.i18n.getMessage("restoreWarning");

});


 
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
        var backupObj;

        if (tempObj.Version) {
            backupObj = tempObj.Groups;
        } else if (tempObj.version) {
            backupObj = tempObj.groups;
        } else {
            // pre-v3 migration backup
            backupObj = tempObj;
        }

        for (var group in backupObj){
            backupObj[group].storage=='sync' ? countSync+=1 : countLocal+=1;
        }
        if (countSync>0){
            document.getElementById("importSyncFileLink").innerHTML=chrome.i18n.getMessage("importSyncRules").format(countSync);
            document.getElementById("importSyncFileLink").style.display='block';
            document.getElementById("hintRestore").style.display='block';
            document.getElementById("importSyncFileLink").addEventListener('click', function (e) {
                e.preventDefault();
                restoreBackup('sync');
                return false;
            });
        }
        if (countLocal>0){
            document.getElementById("importLocalFileLink").innerHTML=chrome.i18n.getMessage("importLocalRules").format(countLocal);
            document.getElementById("importLocalFileLink").style.display='block';
            document.getElementById("hintRestore").style.display='block';
            document.getElementById("importLocalFileLink").addEventListener('click', function (e) {
                e.preventDefault();
                restoreBackup('local');
                return false;
            });
        }
    });
}

function restoreBackup(storage) {
    readFile(function(fileObj){
        // Normalise pre-v3 backups that lack version/groups keys
        if (!fileObj.version && !fileObj.Version && !fileObj.groups && !fileObj.Groups) {
            var tempObj = {Groups: fileObj};
            tempObj.Version = "20";
        } else {
            var tempObj = fileObj;
        }

        // Keep only groups that belong to the requested storage type
        for (var group in tempObj.Groups) {
            if (tempObj.Groups[group].storage != storage) {
                delete tempObj.Groups[group];
            }
        }

        chrome.runtime.sendMessage({command: "upgradeFromPreV3", data: tempObj, type: storage}, function(result) {
            if (chrome.runtime.lastError || !result) {
                document.getElementById('importError').innerText = chrome.i18n.getMessage("popup_importFailed");
                return;
            }

            var backup = result.upgraded;

            if (storage == 'local') {
                chrome.storage.local.clear(function(){
                    var settings = {
                        donate:             backup.donate,
                        enabled:            backup.enabled,
                        performanceSetting: backup.performanceSetting,
                        printHighlights:    backup.printHighlights,
                        showFoundWords:     backup.showFoundWords,
                        version:            backup.version,
                        neverHighlightOn:   backup.neverHighlightOn,
                        license:            backup.license,
                        installId:          backup.installId
                    };
                    if (backup.backup) { settings.backup = backup.backup; }
                    chrome.storage.local.set({['Settings']: settings}, function(){
                        restoreGroups(storage, backup);
                    });
                });
            } else {
                chrome.storage.sync.clear(function(){
                    restoreGroups(storage, backup);
                });
            }
        });
    });
}

function restoreGroups(storage, backup) {
    var promises = [];
    for (var group in backup.groups) {
        if (backup.groups[group].storage == storage) {
            (function(groupId, groupData){
                var promise = new Promise(function(resolve){
                    restoreGroup(storage, groupId, groupData, resolve);
                });
                promises.push(promise);
            })(group, backup.groups[group]);
        }
    }
    Promise.all(promises).then(function(){
        document.getElementById('uploadform').style.display = 'none';
        document.getElementById('importDone').style.display = 'block';
        setTimeout(function(){ window.close(); }, 3000);
    });
}

function restoreGroup(storage, groupId, group, callback) {
    chrome.storage[storage].set({[groupId]: group}, function(){
        callback();
    });
}
