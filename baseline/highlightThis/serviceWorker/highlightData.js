import * as utilities from './utilities.js';
import * as offScreen from './offScreen.js';
import * as notifications from './notifications.js';

const debug=false;


export function exportToFile() {
    Promise.all([
        new Promise((resolve, reject) => chrome.storage.local.get( result => resolve(result))),
        new Promise((resolve, reject) => chrome.storage.sync.get(result => resolve(result)))
    ]).then(([localData, syncData]) => {

        if (localData.Settings.backup&&localData.Settings.backup.frequency!=='never'&&shouldExecuteBackup(localData.Settings.backup.frequency,localData.Settings.backup.last)){
            delete syncData.Settings;

            const storage = Object.assign({}, localData, syncData);
            
            delete storage.Settings;
            let backupObj=localData.Settings;
            backupObj.groups=storage;

            (async () => {
                await offScreen.setupOffscreenDocument('/offscreen/backupPage.html');
              
                // Send message to offscreen document
                chrome.runtime.sendMessage({
                  type: 'backup',
                  target: 'offscreen',
                  data: backupObj
                });
            })();

            localData.Settings.backup.last=Date.now();

            chrome.storage.local.set({['Settings']:localData.Settings},function(){

            });
        } 
    });
}


function shouldExecuteBackup(frequency, lastExecuted) {
    if(lastExecuted==null) {return true;}
    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000; // milliseconds in a day
    const oneWeek = oneDay * 7;
    const oneMonth = oneDay * 30; // assuming an average month is about 30 days

    let difference = now - lastExecuted;

    if (frequency === 'daily' && difference >= oneDay) {
        return true;
    } else if (frequency === 'weekly' && difference >= oneWeek) {
        return true;
    } else if (frequency === 'monthly' && difference >= oneMonth) {
        return true;
    }

    return false;
}

export function resetAll(){
    chrome.storage.sync.clear();
    chrome.storage.local.clear(function(){
        setInitialData();
    });
}

export function setInitialData(){

    var today=new Date();

    var settings = {
        version: '21',
        neverHighlightOn: [],
        enabled: true,
        showFoundWords: true,
        printHighlights: true,
        rangeHighlighting: true,
        performanceSetting: 200,
        installId: utilities.uuidv4(),
        license: {
            type:'Temp',
            validUntil: today.setDate(today.getDate()+30)
        }
    };

    chrome.storage.local.set({['Settings']:settings},function(){
        debug && console.info('initial settings created')
    });

    var firstGroup= {
        name: chrome.i18n.getMessage("first_list"),
        action: {actionLink: '',type: '0'},
        caseSensitive: false,
        color: '#FFFF66',
        dontShowOn: [],
        enabled: true,
        fColor: '',
        findWords: false,
        notifyFrequency: '1',
        notifyOnHighlight: false,
        regexTokens: false,
        showInEditableFields: false,
        showOn: [],
        storage: 'local',
        type: 'local',
        words: [],
        containerSelector: '',
        modified: Date.now()
    }

    chrome.storage.local.set({[utilities.uuidv4()]:firstGroup},function(){
        debug && console.info('initial group created')
    });
}

export function saveNewWordList(storage, wordListObject) {
    var wordListId=utilities.uuidv4();
    if(storage=='local') {
        chrome.storage.local.set({[wordListId]:wordListObject},function(){});
    }
    else if (storage=='sync') {
        chrome.storage.sync.set({[wordListId]:wordListObject},function(){});
    }
    return wordListId;
}

export function addWordToList(groupId, word, callback) {
    Promise.all([
        new Promise((resolve, reject) => chrome.storage.local.get( result => resolve(result))),
        new Promise((resolve, reject) => chrome.storage.sync.get(result => resolve(result)))
      ]).then(([localData, syncData]) => {
        const combinedData = Object.assign({}, localData, syncData);
        var group=combinedData[groupId];
        //console.log(group);
        if (group.words.indexOf(word)>-1) {
            var wordAlreadyAdded = true;
            console.error('word already in list');
        }
        else {
            var boolNotified=false;
            if(cjkCharacters(word) && group.findWords) {
                // if there are no words in the list then let's switch the checkbox
                if(group.words.length==0){
                    group.findWords=false;
                }
                else {
                    boolNotified=true;
                    notifications.notifyNonWhitespaceBoundaryWordAdded(word);
                }
            }

            group.words.push(word);
            group.modified = Date.now();
            if(group.storage=='local') {
                chrome.storage.local.set({[groupId]:group},function(){            callback();
                });
            }
            else if (group.storage=='sync') {
                chrome.storage.sync.set({[groupId]:group},function(){            callback();
                });
            }

            !boolNotified && notifications.notifyWordAdded(word,group.name);
        }
      }).catch(error => {
        console.error('error retrieving data', error);
    });
}

function cjkCharacters(value){
    const cjkRegex = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF65-\uFFDC]/

    if(cjkRegex.test(value)){
       return true;
    }
    
    return false;
}

export function showHighlights(count, inTabId, inUrl) 
{
  chrome.action.setBadgeText({"text":count > 0 ? count.toString() : "","tabId":inTabId}); 
  chrome.action.setBadgeBackgroundColor ({"color":"#0091EA"});
  chrome.action.setBadgeTextColor ({"color":"#FFFFFF"});
}


export function upgradeDataFromPreV3(inData, type){

    var latestVersion="21"; // version 21 of storage is the first v3 version

    if(inData.version && inData.version=="21"){
        return inData
    }
    if(type=="sync"){
        delete inData.Groups.Settings;
    } //avoids upgrading settings


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
        type=='local' && (inData.installId=utilities.uuidv4());
        inData.Version="20";
    }
    if (inData.Version=="20"){
        inData.groups={};
        for (var highlightData in inData.Groups) {
            //force the right storage type
            inData.Groups[highlightData].storage=type;
            inData.Groups[highlightData].color=inData.Groups[highlightData].Color;
            inData.Groups[highlightData].dontShowOn=inData.Groups[highlightData].DontShowOn;
            inData.Groups[highlightData].enabled=inData.Groups[highlightData].Enabled;
            inData.Groups[highlightData].fColor=inData.Groups[highlightData].Fcolor;
            inData.Groups[highlightData].findWords=inData.Groups[highlightData].FindWords;
            inData.Groups[highlightData].modified=inData.Groups[highlightData].Modified;
            inData.Groups[highlightData].notifyFrequency=inData.Groups[highlightData].NotifyFrequency;
            inData.Groups[highlightData].notifyOnHighlight=inData.Groups[highlightData].NotifyOnHighlight;
            inData.Groups[highlightData].showInEditableFields=inData.Groups[highlightData].ShowInEditableFields;
            inData.Groups[highlightData].showOn=inData.Groups[highlightData].ShowOn;
            inData.Groups[highlightData].type=inData.Groups[highlightData].Type;
            inData.Groups[highlightData].words=inData.Groups[highlightData].Words;
            inData.Groups[highlightData].remoteConfig=inData.Groups[highlightData].RemoteConfig;
            inData.Groups[highlightData].border=true;
            inData.Groups[highlightData].bold=false;
            inData.Groups[highlightData].padding=true;
            inData.Groups[highlightData].radius=true;
            inData.Groups[highlightData].italic=false;
            inData.Groups[highlightData].underline=false;
            inData.Groups[highlightData].containerSelector='';
            inData.Groups[highlightData].name=highlightData;
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
            inData.groups[utilities.uuidv4()]=inData.Groups[highlightData];
        }
        delete inData.Groups;

        inData.version="21";
        inData.enabled=true;
        inData.performanceSetting=inData.PerformanceSetting;
        inData.printHighlights=inData.PrintHighlights;
        inData.showFoundWords=inData.ShowFoundWords;
        inData.neverHighlightOn=inData.neverHighlightOn;
        inData.installId = inData.installId;
        inData.license={type: 'Free'};
        delete inData.ShowFoundWords;
        delete inData.PrintHighlights;
        delete inData.PerformanceSetting;
        delete inData.Donate;
        delete inData.Version;
     
    }
    return inData;
}


export async function syncWordList(groupId, notify, save, remoteConfig,  callback){
    debug && console.log('syncing ' + groupId)
    //var xhr = new XMLHttpRequest();

    Promise.all([
        new Promise((resolve, reject) => chrome.storage.local.get(result => resolve(result))),
        new Promise((resolve, reject) => chrome.storage.sync.get(result => resolve(result)))
      ]).then(([localData, syncData]) => {
        const combinedData = Object.assign({}, localData, syncData);
        var group=combinedData[groupId];

        if (!remoteConfig) remoteConfig=group.remoteConfig;
        debug && console.log(group);
        if (remoteConfig){
            switch(remoteConfig.type){
                case 'pastebin':
                    var getSitesUrl='https://pastebin.com/raw/'+remoteConfig.id;
                    break;
                case 'web':
                    var getSitesUrl=remoteConfig.url;
                    break;
                case 'googleSheets':

                    var getSitesUrl='https://docs.google.com/spreadsheets/d/'+remoteConfig.id+'/export?format=tsv'

                    //var getSitesUrl='https://docs.google.com/spreadsheets/d/e/'+remoteConfig.id+'/pub?output=csv';
                
                   // var getSitesUrl='https://spreadsheets.google.com/feeds/cells/'+remoteConfig.id+'/1/public/values?alt=json';
            }
        }

        fetch(getSitesUrl).then((response)=>{
            if (response.ok) {
                return response.text();
            }   
            throw new Error('Network response was not ok.');         
        }).then((body)=>{
            var wordsToAdd=[];

            if(remoteConfig.type=='googleSheets'){
                /*result=JSON.parse(body);
                result.feed.entry.forEach(function(e){if(e.gs$cell.col==1)wordsToAdd.push(e.content.$t)})*/
                /*wordsToAdd = body.split("\n").split('\t').filter(function (e) {
                    return e;
                });*/

                let parsedRows = parseTSV(body);
                wordsToAdd = extractFirstColumn(parsedRows);

            }
            else {
                
                //TODO - purify the response
                //const purify = DOMPurify(window);

                //var resp = purify.sanitize(body);
                wordsToAdd = body.split("\n").filter(function (e) {
                    return e;
                });
            }
            for(var word in wordsToAdd){
                wordsToAdd[word]=wordsToAdd[word].replace(/(\r\n|\n|\r)/gm,"");
            }
            group.words=wordsToAdd;
            remoteConfig.lastUpdated=Date.now();
            group.remoteConfig=remoteConfig;
            /*if(notify){
                notifySyncedList(group.name);
            }  */

            if(save){
                if(group.storage=='local') {
                    chrome.storage.local.set({[groupId]:group},function(){            
                        callback({success:true, words: wordsToAdd, lastUpdated: remoteConfig.lastUpdated});
                    });
                }
                else if (group.storage=='sync') {
                    chrome.storage.sync.set({[groupId]:group},function(){            
                        callback({success:true, words: wordsToAdd, lastUpdated: remoteConfig.lastUpdated});
                    });
                }
    
            }
            callback({success:true, words: wordsToAdd, lastUpdated: remoteConfig.lastUpdated});
        })
        .catch((err)=>{
            console.log(err);
            callback({success:false, message:err.message});
        });
    });
}

function parseTSV(tsvText) {
    let rows = [];
    let currentRow = [];
    let currentCell = "";
    let inQuotes = false;

    for (let char of tsvText) {
        if (char === '"' && !inQuotes) {
            inQuotes = true;
        } else if (char === '"' && inQuotes) {
            inQuotes = false;
        } else if (char === '\t' && !inQuotes) {
            currentRow.push(currentCell);
            currentCell = "";
        } else if (char === '\n' && !inQuotes) {
            currentRow.push(currentCell);
            rows.push(currentRow);
            currentCell = "";
            currentRow = [];
        } else {
            currentCell += char;
        }
    }

    // Add the last cell and row (if not empty)
    if (currentCell !== "" || currentRow.length > 0) {
        currentRow.push(currentCell);
        rows.push(currentRow);
    }

    return rows;
}

// Function to extract the first column from the parsed TSV data
function extractFirstColumn(parsedRows) {
    return parsedRows.map(row => row[0]);
}

export function syncData(){
    debug && console.log(Date().toString() + " - start sync");

    Promise.all([
        new Promise((resolve, reject) => chrome.storage.local.get( result => resolve(result))),
        new Promise((resolve, reject) => chrome.storage.sync.get(result => resolve(result)))
    ]).then(([localData, syncData]) => {
        const groups = Object.assign({}, localData, syncData);
        delete groups.Settings;
        
        for (var group in groups){
            if (groups[group].type=='remote'){
                var sync=false;
                if(groups[group].remoteConfig.lastUpdated) {
                    var lastUpdated=new Date(groups[group].remoteConfig.lastUpdated);
                    var now= new Date();
                    
                    if(((now-lastUpdated)/60000)>Number(groups[group].remoteConfig.syncFrequency)){
                        sync=true;
                    }
                }
                else {
                    sync=true;
                }
   
                sync && syncWordList(group, true, true,groups[group].remoteConfig, function(){});
            }

        }

    });
}

export function detectAndRepairSync(){
    chrome.storage.sync.get(function(syncLists){
        var dataChanged=false;
        var inData={Groups: syncLists, groups:{}}
        delete inData.Groups.Settings;
        for (var highlightData in inData.Groups) {
            // check if the group is the old or new format
            if(!inData.Groups[highlightData].name){
                inData.Groups[highlightData].storage='sync';
                inData.Groups[highlightData].color=inData.Groups[highlightData].Color;
                inData.Groups[highlightData].dontShowOn=inData.Groups[highlightData].DontShowOn;
                inData.Groups[highlightData].enabled=inData.Groups[highlightData].Enabled;
                inData.Groups[highlightData].fColor=inData.Groups[highlightData].Fcolor;
                inData.Groups[highlightData].findWords=inData.Groups[highlightData].FindWords;
                inData.Groups[highlightData].modified=inData.Groups[highlightData].Modified;
                inData.Groups[highlightData].notifyFrequency=inData.Groups[highlightData].NotifyFrequency;
                inData.Groups[highlightData].notifyOnHighlight=inData.Groups[highlightData].NotifyOnHighlight;
                inData.Groups[highlightData].showInEditableFields=inData.Groups[highlightData].ShowInEditableFields;
                inData.Groups[highlightData].showOn=inData.Groups[highlightData].ShowOn;
                inData.Groups[highlightData].type=inData.Groups[highlightData].Type;
                inData.Groups[highlightData].words=inData.Groups[highlightData].Words;
                inData.Groups[highlightData].remoteConfig=inData.Groups[highlightData].RemoteConfig;
                inData.Groups[highlightData].border=true;
                inData.Groups[highlightData].bold=false;
                inData.Groups[highlightData].padding=true;
                inData.Groups[highlightData].radius=true;
                inData.Groups[highlightData].italic=false;
                inData.Groups[highlightData].underline=false;
                inData.Groups[highlightData].containerSelector='';
                inData.Groups[highlightData].name=highlightData;
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

                inData.groups[utilities.uuidv4()]=inData.Groups[highlightData];
                dataChanged=true;
            }
            else {
                inData.groups[highlightData]=inData.Groups[highlightData];
            }
        }
        delete inData.Groups;
        if (dataChanged){

            chrome.storage.sync.clear(function(){

                chrome.storage.sync.set({"Settings":{"version":21}});
                
                for(var group in inData.groups){
                    chrome.storage.sync.set({[group]:inData.groups[group]});
                } 
            })
            
            debug&&console.log('Need to save', inData.groups);
        }
        
    });
    
}