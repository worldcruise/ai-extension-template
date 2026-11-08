import * as utilities from './utilities.js' 

const debug=false;
var noContextMenu=["_generated_background_page.html","chrome://newtab/"]; 

export function createContextMenu(){
    chrome.runtime.getPlatformInfo(
        function (i) {

            if (i.os == "mac") {
                var shortcut = "Shift+Cmd+Space";
            }
            else {
                var shortcut = "Shift+Ctrl+Space";
            }
            try {
                var highLight = chrome.contextMenus.create({
                    "title": chrome.i18n.getMessage("jump_to_word") + " (" + shortcut + ")",
                    "id": "Highlight"
                });

                var separator=chrome.contextMenus.create({
                    "type": "separator",
                    "contexts": ["all"],
                    "id": "separator"
                });
                var manage = chrome.contextMenus.create({
                    "title": "Manage",
                    "contexts": ["all"],
                    "id": "Manage"
                });
            }
            catch {

            }

        }
    );
}

export function updateContextMenu(inUrl, groups){
    debug&&console.info('updating context menu');

    if(noContextMenu.indexOf(inUrl)==-1){
        chrome.contextMenus.removeAll(function(){

            var contexts = ["selection"];
            
            var numItems=0;
            createContextMenu();

            for (var i = 0; i < contexts.length; i++) {
                var context = contexts[i];
                for (var group in groups){
                    var menuItemId="AddTo_" + groups[group].id
                    if (numItems==chrome.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT){
                        //create a parent menu
                        var parentid = chrome.contextMenus.create({
                            "title": chrome.i18n.getMessage("more"), "contexts": [context],
                            "id": "more"
                        });
                    }
                    var title = "+ " + groups[group].name;
                    if (numItems>(chrome.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT-1)){
                        var id = chrome.contextMenus.create({
                            "title": title, "contexts": [context],
                            "id": menuItemId, "parentId":"more"
                        });
                    } else {
                        var id = chrome.contextMenus.create({
                            "title": title, "contexts": [context],
                            "id": menuItemId
                        });
                    }
                    numItems+=1;       
                }
            }
        });
    }
}


