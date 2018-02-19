
//#region Global variables
var TotalItemsUpload = 0;
var TotalFilesUpload = 0;
var TotalFoldersUpload = 0;
var maxSimultaneousUploads = 500;
var TotalUploaded = 0;
var TotalFilesSize = 0;
var activeUploads = 0;
var uploadsQueue = [];
//var currentFileStartTime = new Date();
var CurrentItemName = "";
var startTime = new Date();
var FoldersList = [];
var IsUploadingStart = false;
var ErrorList = [];
var UpdatedFoldername = "";
var GlobalInnerFiles = [];
var GlobalOuterData = [];
var GlobalInnerFolders = [];
var ParentFolderId = $('#hdnFolderId').val();
var Timer = null;
var TotalOuterFolders = 0;
var UploadedOuterFolders = 0;
var TotalInnerFolders = 0;
var UploadedInnerFolders = 0;
var TotalOuterFiles = 0;
var UploadedOuterFiles = 0;
var objOuterFiles = [];
var GlobalFiles = [];
//#endregion

$(document).ready(function () {
    setInterval(ExtendTimeOut, 50000);
});

function ExtendTimeOut() {
    // to extend session timer
    parent.parent.store.set('idleTimerLastActivity', $.now());
}

//#region HTML5 FileAPI Process
var DEFAULT_FILES_TO_IGNORE = ['.DS_Store', // OSX indexing file
    'Thumbs.db' // Windows indexing file
];

function shouldIgnoreFile(file) {
    return DEFAULT_FILES_TO_IGNORE.indexOf(file.name) >= 0;
}

function traverseDirectory(entry) {
    var obj = { "fullPath": entry.fullPath, "name": entry.name }
    FoldersList.push(obj);
    var reader = entry.createReader();
    // Resolved when the entire directory is traversed
    return new Promise(function (resolveDirectory) {
        var iterationAttempts = [];
        var errorHandler = function errorHandler(e) { /*console.log("FolderError", e);*/ };
        function readEntries() {
            // According to the FileSystem API spec, readEntries() must be called until
            // it calls the callback with an empty array.
            reader.readEntries(function (batchEntries) {
                if (!batchEntries.length) {
                    // Done iterating this particular directory
                    resolveDirectory(Promise.all(iterationAttempts));
                } else {
                    // Add a list of promises for each directory entry.  If the entry is itself
                    // a directory, then that promise won't resolve until it is fully traversed.
                    iterationAttempts.push(Promise.all(batchEntries.map(function (batchEntry) {
                        if (batchEntry.isDirectory) {
                            return traverseDirectory(batchEntry);
                        }
                        return Promise.resolve(batchEntry);
                    })));
                    // Try calling readEntries() again for the same dir, according to spec
                    readEntries();
                }
            }, errorHandler);
        }
        // initial call to recursive entry reader function
        readEntries();
    });
}

// package the file in an object that includes the fullPath from the file entry
// that would otherwise be lost
function packageFile(file, entry) {
    var fileTypeOverride = '';
    // handle some browsers sometimes missing mime types for dropped files
    var hasExtension = file.name.lastIndexOf('.') !== -1;
    if (hasExtension && !file.type) {
        //fileTypeOverride = _mimeTypes2.default.lookup(file.name);
    }
    return {
        fileObject: file,
        type: file.type, //? file.type : fileTypeOverride,
        name: file.name,
        size: file.size,
        fullPath: entry ? entry.fullPath : file.name
    };
}

function getFile(entry) {
    return new Promise(function (resolve) {
        if (entry != undefined && entry != null) {
            entry.file(function (file) {
                resolve(packageFile(file, entry));
            }, function (ex) { /*console.log(ex);*/ resolve(undefined); });
        }
        else {
            resolve(undefined);
        }
    });
}

function handleFilePromises(promises, fileList) {
    return Promise.all(promises).then(function (files) {
        files.forEach(function (file) {
            if (file != undefined) {
                if (!shouldIgnoreFile(file)) {
                    fileList.push(file);
                }
            }
        });
        return fileList;
    });
}

function getDataTransferFiles(dataTransfer) {
    var dataTransferFiles = [];
    var folderPromises = [];
    var filePromises = [];

    [].slice.call(dataTransfer.items).forEach(function (listItem) {
        if (typeof listItem.webkitGetAsEntry === 'function') {
            var entry = listItem.webkitGetAsEntry();

            if (entry && entry.isDirectory) {
                folderPromises.push(traverseDirectory(entry));
            } else {
                filePromises.push(getFile(entry));
            }
        } else {
            dataTransferFiles.push(listItem);
        }
    });
    if (folderPromises.length) {
        var flatten = function flatten(array) {
            return array.reduce(function (a, b) {
                return a.concat(Array.isArray(b) ? flatten(b) : b);
            }, []);
        };
        return Promise.all(folderPromises).then(function (fileEntries) {
            var flattenedEntries = flatten(fileEntries);
            // collect async promises to convert each fileEntry into a File object
            flattenedEntries.forEach(function (fileEntry) {
                filePromises.push(getFile(fileEntry));
            });
            return handleFilePromises(filePromises, dataTransferFiles);
        });
    } else if (filePromises.length) {
        return handleFilePromises(filePromises, dataTransferFiles);
    }
    return Promise.resolve(dataTransferFiles);
}

/**
 * This function should be called from both the onDrop event from your drag/drop
 * dropzone as well as from the HTML5 file selector input field onChange event
 * handler.  Pass the event object from the triggered event into this function.
 * Supports mix of files and folders dropped via drag/drop.
 *
 * Returns: an array of File objects, that includes all files within folders
 *   and subfolders of the dropped/selected items.
 */
function getDroppedOrSelectedFiles(event) {
    var dataTransfer = event.dataTransfer;
    if (dataTransfer && dataTransfer.items) {
        return getDataTransferFiles(dataTransfer).then(function (fileList) {
            return Promise.resolve(fileList);
        });
    }
    var files = [];
    var dragDropFileList = dataTransfer && dataTransfer.files;
    var inputFieldFileList = event.target && event.target.files;
    var fileList = dragDropFileList || inputFieldFileList || [];
    // convert the FileList to a simple array of File objects
    for (var i = 0; i < fileList.length; i++) {
        files.push(packageFile(fileList[i]));
    }
    return Promise.resolve(files);
}
//#endregion

//#region Handle Dragged Or Selected Items upload
if (window.File && window.FileList && window.FileReader) {
    Init();
}

function Init() {
    var filedrag = document.getElementById("UploadZone");
    // is XHR2 available?
    var xhr = new XMLHttpRequest();
    if (xhr.upload) {
        // file drop
        filedrag.addEventListener("dragover", FileDragHover, false);
        filedrag.addEventListener("dragleave", FileDragHover, false);
        filedrag.addEventListener("drop", FileSelectHandler, false);
        document.getElementById('files').addEventListener('change', InputFilesUpload, false);
    }
}

function FileDragHover(e) {
    e.stopPropagation();
    e.preventDefault();
    document.getElementById('UploadZone').className = (e.type == "dragover" ? "file-sec hover" : "file-sec");
}

function FileSelectHandler(e) {
    FileDragHover(e);
    HandleDraggedItems(e);
}

function HandleDraggedItems(e) {
    if (IsUploadingStart == false) {

        ErrorList = [];
        uploadsQueue = [];
        FoldersList = [];
        GlobalInnerFiles = [];
        GlobalInnerFolders = [];
        GlobalOuterData = [];
        objOuterFiles = [];
        GlobalFiles = [];

        var files = e.target.items || e.dataTransfer.items;
        if (files != undefined && files != null) {
            fnStartLoading();
            getDroppedOrSelectedFiles(e).then(function (selectedFiles) {
                fnStopLoading();
                TotalFilesUpload = selectedFiles.length;
                TotalFoldersUpload = FoldersList.length;
                SetTotalItemsCounter();
                if (IsOwner == "false" && FoldersList.length > 0) {
                    IsUploadingStart = false;
                    ShowMessages(5);
                }
                else {
                    if (TotalItemsUpload > 0) {
                        GetTotalFilesSize(selectedFiles);
                        var IsContinueUpload = CheckDataRoomCap(TotalFilesSize);
                        if (IsContinueUpload) {
                            IsUploadingStart = true;
                            SetProgress(0);
                            $("#UploadZone").hide();

                            GlobalFiles = GlobalFiles.concat(selectedFiles);

                            if (FoldersList.length > 0) {
                                //objOuterFiles = selectedFiles.filter(function (file) {
                                //    if (file != undefined) {
                                //        var FilePath = file.fullPath.substring(0, file.fullPath.lastIndexOf("/"));
                                //        return (FilePath == "");
                                //    }
                                //});

                                for (var k = 0; k < FoldersList.length; k++) {
                                    var FolderPath = FoldersList[k].fullPath.substring(0, FoldersList[k].fullPath.lastIndexOf("/"));
                                    if (FolderPath == "") {
                                        GlobalOuterData.push(FoldersList[k]);
                                    }
                                    else {
                                        GlobalInnerFolders.push(FoldersList[k]);
                                    }
                                    //var objInnerFiles = selectedFiles.filter(function (file) {
                                    //    if (file != undefined) {
                                    //        var FilePath = file.fullPath.substring(0, file.fullPath.lastIndexOf("/"));
                                    //        return (FilePath == FoldersList[k].fullPath);
                                    //    }
                                    //});
                                    //GlobalInnerFiles = GlobalInnerFiles.concat(objInnerFiles);
                                }

                                ////Sort Outer Folders
                                //GlobalOuterData.sort(function (a, b) {
                                //    var nameA = a.name;
                                //    var nameB = b.name;
                                //    return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(nameA, nameB);
                                //});
                                ////Sort Inner Folders
                                //GlobalInnerFolders.sort(function (a, b) {
                                //    var nameA = a.fullPath;
                                //    var nameB = b.fullPath;
                                //    return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(nameA, nameB);
                                //});
                                ////Sort Inner Files
                                //GlobalInnerFiles.sort(function (a, b) {
                                //    var nameA = a.fullPath;
                                //    var nameB = b.fullPath;
                                //    return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(nameA, nameB);
                                //});


                                TotalOuterFolders = GlobalOuterData.length;
                                for (var j = 0; j < GlobalOuterData.length; j++) {
                                    var Item = GlobalOuterData[j];
                                    var ItemType = 1;
                                    SendOuterFolders(Item.name, Item.fullPath, ItemType, ParentFolderId, false);
                                }
                            }
                            else if (selectedFiles.length > 0) {
                                HandleFilesRequest(selectedFiles, false);
                            }
                        }
                    }
                    else {
                        //No Files Found
                        IsUploadingStart = false;
                        ShowMessages(7);
                    }
                }

            })
        }
        else {
            //Not Supported || IE
            var tempfiles = e.target.files || e.dataTransfer.files;
            var isSafari = /Safari/.test(navigator.userAgent) && /Apple Computer/.test(navigator.vendor);
            if (!isSafari) {
                if (tempfiles != undefined && tempfiles != null && tempfiles.length != 0) {
                    TotalFilesUpload = tempfiles.length;
                    SetTotalItemsCounter();

                    GetTotalFilesSize(tempfiles);

                    var IsContinueUpload = CheckDataRoomCap(TotalFilesSize);

                    if (IsContinueUpload) {
                        AddUpdateUploadMasterwithFiles(tempfiles, false, 0);
                    }
                }
                else {
                    IsUploadingStart = false;
                    ShowMessages(4);
                }
            }
            else {
                IsUploadingStart = false;
                ShowMessages(8);
            }
        }
    }
    else {
        ShowMessages(6);
    }
}

function InputFilesUpload(e) {
    //When File Selected From File Input Control
    if (IsUploadingStart == false) {
        var tempfiles = e.target.files;
        //console.log(tempfiles);
        if (tempfiles != undefined && tempfiles != null && tempfiles.length != 0) {
            var length = tempfiles.length;
            var IsFolderInnerItem = false;
            TotalFilesUpload = length;
            SetTotalItemsCounter();
            GetTotalFilesSize(tempfiles);
            var IsContinueUpload = CheckDataRoomCap(TotalFilesSize);
            if (IsContinueUpload) {
                IsUploadingStart = true;
                AddUpdateUploadMasterwithFiles(tempfiles, false, 0);
            }
        }
    }
    else {
        ShowMessages(6);
    }
}

function AddUpdateUploadMasterwithFiles(tempfiles, IsFolderInnerItem, Mode) {
    //Create json object for Files Bulk Insert  
    if (Mode == 1) {
        tempfiles.sort(function (a, b) {
            var nameA = a.fullPath;
            var nameB = b.fullPath;
            return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(nameA, nameB);
        });
    }
    var data = $.map(tempfiles, function (n) {
        var fullPath = (n.fullPath == undefined ? '' : n.fullPath.substring(0, n.fullPath.lastIndexOf('/')));
        return { FileName: n.name, FileLength: n.size, FullPath: fullPath };
    });
    //console.log("{ YardMasterID: '" + $('#hdnYardMasterID').val() + "',UploadMasterID: " + parent.$('#ctl00_ContentPlaceHolder1_hdnUploadMasterID').val() + ",StatusID:1,Mode:1,FolderId:'" + ParentFolderId + "',TabMasterId:'" + $('#hdnTabMasterId').val() + "',IsUploadDraft:" + $('#hdnIsUploadDraft').val() + ",Files:'" + escape(JSON.stringify(data)) + "'}");
    //Call AddUpdateUploadMaster WebMethod for Files Bulk Insert
    var URL = getBulkUploadURL();
    $.ajax({
        type: "POST",
        url: URL,
        //url: "UploadItems.aspx/AddUpdateUploadMaster",
        data: "{ YardMasterID: '" + $('#hdnYardMasterID').val() + "',UploadMasterID: " + parent.$('#ctl00_ContentPlaceHolder1_hdnUploadMasterID').val() + ",StatusID:1,Mode:1,FolderId:'" + ParentFolderId + "',TabMasterId:'" + $('#hdnTabMasterId').val() + "',IsUploadDraft:" + $('#hdnIsUploadDraft').val() + ",Files:'" + escape(JSON.stringify(data)) + "'}",
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        //cache: false,
        //async: false,
        success: function (response) {
            //alert('On success');            
            //parent.$('#ctl00_ContentPlaceHolder1_hdnUploadMasterID').val(response.d);
            //parent.$('#ctl00_ContentPlaceHolder1_hdnIsUploadDone').val(response.d);
            parent.$('#ctl00_ContentPlaceHolder1_hdnUploadMasterID').val(response);
            parent.$('#ctl00_ContentPlaceHolder1_hdnIsUploadDone').val(response);
            SetProgress(0);
            $("#UploadZone").hide();
            for (var j = 0; j < tempfiles.length; j++) {
                if (Mode == 1) {
                    SendSyncFiles(tempfiles[j].fileObject, tempfiles[j].fullPath, 2, ParentFolderId, IsFolderInnerItem);
                }
                else {
                    SendSyncFiles(tempfiles[j], tempfiles[j].fullPath, 2, ParentFolderId, IsFolderInnerItem);
                }
            }
        },
        Error: function (x, e) {
            // On Error
            ShowMessages(9);
        },
        failure: function (response) {
            // On Error
            //alert(response.d);
            ShowMessages(9);
        }
    });
}


function HandleFilesRequest(Files, IsFolderRemain) {
    Files.sort(function (a, b) {
        var nameA = a.fullPath.toLowerCase();
        var nameB = b.fullPath.toLowerCase();
        return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(nameA, nameB);
    });

    AddUpdateUploadMasterwithFiles(Files, false, 1);
    //Files.forEach(function (file) {
    //    if (file != undefined) {
    //        if (IsFolderRemain) {
    //            SendOuterSyncFiles(file.fileObject, file.fullPath, 2, ParentFolderId, false);
    //        }
    //        else {
    //        SendSyncFiles(file.fileObject, file.fullPath, 2, ParentFolderId, false);
    //        }
    //    }
    //});
}
//#endregion

//#region CheckDataRoomCap
function CheckDataRoomCap(TotalAllFileSize) {
    var IsContinueUpload = false;
    $.ajax({
        type: "POST",
        url: GetURLForCheckDataRoomCap(),
        data: JSON.stringify({ 'YardMasterID': $('#hdnYardMasterID').val() }),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        cache: false,
        async: false,
        success: function (objResponse) {
            if (objResponse.TotalDataCap != -1) {
                var RemainingDataCapInBytes = (objResponse.RemainingDataCap) * 1024;
                if (TotalAllFileSize > RemainingDataCapInBytes) {
                    IsUploadingStart = false;
                    var RemainRoomSize = FormatFileSize(objResponse.RemainingDataCap);
                    var TotalRoomSize = FormatFileSize(objResponse.TotalDataCap);
                    ShowDataCapWarningMessage(RemainRoomSize, TotalRoomSize);
                }
                else {
                    IsContinueUpload = true;
                }
            }
            else {
                IsContinueUpload = true;
            }
        }
    });
    return IsContinueUpload;
}

function FormatFileSize(kbytes, decimalPoint) {
    //if (kbytes == 0) { return '0 KB'; }
    //else if (kbytes < 1) { return '1 KB'; }
    //var k = 1024,
    //    dm = decimalPoint || 2,
    //    sizes = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
    //    i = Math.floor(Math.log(kbytes) / Math.log(k));
    //return parseFloat((kbytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    var sizes = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    var i = 0;
    while (kbytes > 1024) {
        kbytes = kbytes / 1024;
        i++;
    }
    return (Math.round(kbytes * 100) / 100) + ' ' + sizes[i];
}
//#endregion

//#region Handle Request/Response Items upload
function SendOuterFolders(Item, FullPath, Type, ParentFolderId, IsFolderInnerItem) {
    if (activeUploads === maxSimultaneousUploads) {
        var obj = { 'Item': Item, 'FullPath': FullPath, 'Type': Type, 'ParentFolderId': ParentFolderId, 'IsFolderInnerItem': IsFolderInnerItem };
        uploadsQueue.push(obj);
        return;
    }
    activeUploads += 1;

    var fd = new FormData();
    if (Type == 1) {
        fd.append("FolderName", Item);
        //console.log("Folder Uploading Start: " + Item);
    }
    else if (Type == 2) {
        fd.append("UploadFiles", Item);
        //console.log("File Uploading Start: " + Item.name);
    }
    fd.append("IsFolderInnerItem", IsFolderInnerItem);
    fd.append("ParentFolderId", ParentFolderId);
    fd.append("FullPath", FullPath == undefined ? "" : FullPath);
    fd.append("Type", Type);
    fd.append("YardMasterId", $('#hdnYardMasterID').val());
    fd.append("TabMasterId", $('#hdnTabMasterId').val());
    fd.append("TabType", TabType);
    fd.append("IsUploadDraft", $('#hdnIsUploadDraft').val());

    var xhr;
    if (window.XMLHttpRequest) {
        xhr = new XMLHttpRequest();
    }
    var URLtoRedt = getUploadFilesURL();
    xhr.open("POST", URLtoRedt, true);
    //xhr.upload.addEventListener("progress", HandleUploadProgress, false);
    xhr.onload = function (evt) {
        //console.log(xhr.status, "status");
        if (xhr.status === 200) {
            activeUploads -= 1;
            var result = JSON.parse(evt.target.responseText);
            if (result.ErrorType == -5) {
                ShowMessages(9);
            }
            else if (result.IsSuccess) {
                if (result.ItemType == 1) {
                    if (result.FolderId == -1) {
                        UpdatedFoldername = "";
                        UpdatedFoldername = result.MSG;
                        if (UpdatedFoldername != "") {
                            //PathRename Start IF Folder Already Exist
                            for (var k = 0; k < GlobalInnerFolders.length; k++) {
                                var parts = GlobalInnerFolders[k].fullPath.split('/');
                                if ('/' + parts[1] == FullPath) {
                                    GlobalInnerFolders[k].fullPath = GlobalInnerFolders[k].fullPath.replace(parts[1], UpdatedFoldername);
                                }
                            }
                            //for (var k = 0; k < GlobalInnerFiles.length; k++) {
                            //    var parts = GlobalInnerFiles[k].fullPath.split('/');
                            //    if ('/' + parts[1] == FullPath) {
                            //        GlobalInnerFiles[k].fullPath = GlobalInnerFiles[k].fullPath.replace(parts[1], UpdatedFoldername);
                            //    }
                            //}
                            for (var k = 0; k < GlobalFiles.length; k++) {
                                var parts = GlobalFiles[k].fullPath.split('/');
                                if ('/' + parts[1] == FullPath) {
                                    GlobalFiles[k].fullPath = GlobalFiles[k].fullPath.replace(parts[1], UpdatedFoldername);
                                }
                            }
                            //End
                        }
                    }
                }
                //console.log("Item Uploaded Done: " + result.ItemName);
            }
            else {
                ErrorList.push(result);
                //console.log("Error: ", result);
            }
            UploadedOuterFolders += 1;
            TotalUploaded += 1;
            ChangeProgress(TotalUploaded);
            // Check if there are any uploads left in a queue:
            if (uploadsQueue.length) {
                var data = uploadsQueue.shift();
                SendOuterFolders(data.Item, data.FullPath, data.Type, data.ParentFolderId, data.IsFolderInnerItem);
            }
            if (UploadedOuterFolders == TotalOuterFolders) {
                //Outer Files
                //TotalOuterFiles = objOuterFiles.length;
                //if (TotalOuterFiles > 0) {
                //    HandleFilesRequest(objOuterFiles, true);
                //}
                //else {
                var IsFolderInnerItem = true;
                TotalInnerFolders = GlobalInnerFolders.length;
                if (TotalInnerFolders > 0) {
                    for (var j = 0; j < GlobalInnerFolders.length; j++) {
                        var Item = GlobalInnerFolders[j];
                        var ItemType = 1;
                        SendInnersFolders(Item.name, Item.fullPath, ItemType, ParentFolderId, IsFolderInnerItem);
                    }
                }
                else {
                    //for (var k = 0; k < GlobalInnerFiles.length; k++) {
                    //    var Item = GlobalInnerFiles[k];
                    //    var ItemType = 2;
                    //    SendSyncFiles(Item.fileObject, Item.fullPath, ItemType, ParentFolderId, IsFolderInnerItem);
                    //}
                    //for (var k = 0; k < GlobalFiles.length; k++) {
                    //    var Item = GlobalFiles[k];
                    //    var ItemType = 2;
                    //    SendSyncFiles(Item.fileObject, Item.fullPath, ItemType, ParentFolderId, IsFolderInnerItem);
                    //}
                    AddUpdateUploadMasterwithFiles(GlobalFiles, false, 1);
                }
                //}
            }
            if (TotalUploaded == TotalItemsUpload) {
                ResetTotalItemsCounter();
                ResetProgressBar();
                //console.log("Total Errors", ErrorList);
                if (ErrorList.length == 0) {
                    parent.$.fancybox.close();
                }
                else {
                    ShowErrorList(ErrorList);
                }
                ShowMessages(1);
                parent.document.getElementById('ifrmMainContainer').contentWindow.refreshcontrol();
            }

        }
        else {
            //console.log('Upload failed-OnSuccess: Status ', xhr.status);
            ShowMessages(2);
            var result = JSON.parse(evt.target.responseText);
            //console.log("Error: ", result);
            //console.log("There was an error attempting to upload the file.");
        }
    }
    xhr.onerror = function (e) {
        //console.log("There was an error attempting to upload the file.");
        ShowMessages(2);
        //console.log('Upload failed-OnError: ', e);
    }
    xhr.onabort = function (e) {
        //console.log("The upload has been canceled by the user or the browser dropped the connection.");
        ShowMessages(3);
        //console.log('Upload failed-onabort: ', CurrentItemName);
    }
    xhr.withCredentials = true;
    xhr.send(fd);
}

function SendSyncFiles(Item, FullPath, Type, ParentFolderId, IsFolderInnerItem) {

    if (activeUploads === maxSimultaneousUploads) {
        var obj = { 'Item': Item, 'FullPath': FullPath, 'Type': Type, 'ParentFolderId': ParentFolderId, 'IsFolderInnerItem': IsFolderInnerItem };
        uploadsQueue.push(obj);
        return;
    }
    activeUploads += 1;

    var fd = new FormData();
    if (Type == 1) {
        fd.append("FolderName", Item);
        //console.log("Folder Uploading Start: " + Item);
    }
    else if (Type == 2) {
        fd.append("UploadFiles", Item);
        //console.log("File Uploading Start: " + Item.name);
    }
    fd.append("IsFolderInnerItem", IsFolderInnerItem);
    fd.append("ParentFolderId", ParentFolderId);
    fd.append("FullPath", FullPath == undefined ? "" : FullPath);
    fd.append("Type", Type);
    fd.append("YardMasterId", $('#hdnYardMasterID').val());
    fd.append("TabMasterId", $('#hdnTabMasterId').val());
    fd.append("TabType", TabType);
    fd.append("IsUploadDraft", $('#hdnIsUploadDraft').val());
    fd.append("UploadMasterID", parent.$('#ctl00_ContentPlaceHolder1_hdnUploadMasterID').val());

    var xhr;
    if (window.XMLHttpRequest) {
        xhr = new XMLHttpRequest();
    }
    var RedirectionURL = getUploadFilesURL();
    xhr.open("POST", RedirectionURL, true);
    //xhr.upload.addEventListener("progress", HandleUploadProgress, false);
    xhr.onload = function (evt) {
        if (xhr.status === 200) {
            activeUploads -= 1;
            if (evt.target.responseText != '') {
                try {
                    var result = JSON.parse(evt.target.responseText);
                    if (result.ErrorType == -5) {
                        ShowMessages(9);
                    }
                    else if (!result.IsSuccess) {
                        ErrorList.push(result);
                    }
                }
                catch (e) {
                    //console.log("Catch Error", e);
                    //console.log("evt.target.responseText Error", evt.target.responseText);
                    var objError = {};
                    objError.ErrorType = '2';
                    objError.IsSuccess = false;
                    objError.ItemName = Item.name;
                    objError.ItemType = 2;
                    ErrorList.push(objError);
                }
                TotalUploaded += 1;
                ChangeProgress(TotalUploaded);

                // Check if there are any uploads left in a queue:
                if (uploadsQueue.length) {
                    var data = uploadsQueue.shift();
                    SendSyncFiles(data.Item, data.FullPath, data.Type, data.ParentFolderId, data.IsFolderInnerItem);
                }

                if (TotalUploaded == TotalItemsUpload) {
                    ResetTotalItemsCounter();
                    ResetProgressBar();
                    if (ErrorList.length == 0) {
                        parent.$.fancybox.close();
                    }
                    else {
                        ShowErrorList(ErrorList);
                    }
                    ShowMessages(1);
                    parent.document.getElementById('ifrmMainContainer').contentWindow.refreshcontrol();
                }
            }
        }
        else {
            //console.log('Upload failed-OnSuccess: Status ', xhr.status, evt.target.responseText);
            //ShowMessages(2);
            activeUploads -= 1;
            TotalUploaded += 1;
            ChangeProgress(TotalUploaded);

            var objError = {};
            objError.ErrorType = -2;
            objError.IsSuccess = false;
            objError.ItemName = Item.name;
            objError.ItemType = 2;
            ErrorList.push(objError);

            // Check if there are any uploads left in a queue:
            if (uploadsQueue.length) {
                var data = uploadsQueue.shift();
                SendSyncFiles(data.Item, data.FullPath, data.Type, data.ParentFolderId, data.IsFolderInnerItem);
            }
            if (TotalUploaded == TotalItemsUpload) {
                ResetTotalItemsCounter();
                ResetProgressBar();
                if (ErrorList.length > 0) {
                    ShowErrorList(ErrorList);
                }
                ShowMessages(1);
                parent.document.getElementById('ifrmMainContainer').contentWindow.refreshcontrol();
            }
        }
    }
    xhr.onerror = function (e) {
        //ShowMessages(2);
        // console.log('Upload failed-OnError: ', e);
        activeUploads -= 1;
        TotalUploaded += 1;
        ChangeProgress(TotalUploaded);

        var objError = {};
        objError.ErrorType = -2;
        objError.IsSuccess = false;
        objError.ItemName = Item.name;
        objError.ItemType = 2;
        ErrorList.push(objError);

        // Check if there are any uploads left in a queue:
        if (uploadsQueue.length) {
            var data = uploadsQueue.shift();
            SendSyncFiles(data.Item, data.FullPath, data.Type, data.ParentFolderId, data.IsFolderInnerItem);
        }

        if (TotalUploaded == TotalItemsUpload) {
            ResetTotalItemsCounter();
            ResetProgressBar();
            if (ErrorList.length > 0) {
                ShowErrorList(ErrorList);
            }
            ShowMessages(1);
            parent.document.getElementById('ifrmMainContainer').contentWindow.refreshcontrol();
        }
    }
    xhr.onabort = function (e) {
        ShowMessages(3);
        //console.log('Upload failed-onabort: ', e);
        TotalUploaded += 1;
        ChangeProgress(TotalUploaded);
        if (TotalUploaded == TotalItemsUpload) {
            ResetTotalItemsCounter();
            ResetProgressBar();
            if (ErrorList.length > 0) {
                ShowErrorList(ErrorList);
            }
            parent.document.getElementById('ifrmMainContainer').contentWindow.refreshcontrol();
        }
    }
    xhr.withCredentials = true;
    xhr.send(fd);
}

function SendInnersFolders(Item, FullPath, Type, ParentFolderId, IsFolderInnerItem) {
    if (activeUploads === maxSimultaneousUploads) {
        var obj = { 'Item': Item, 'FullPath': FullPath, 'Type': Type, 'ParentFolderId': ParentFolderId, 'IsFolderInnerItem': IsFolderInnerItem };
        uploadsQueue.push(obj);
        return;
    }
    activeUploads += 1;

    var fd = new FormData();
    if (Type == 1) {
        fd.append("FolderName", Item);
    }
    else if (Type == 2) {
        fd.append("UploadFiles", Item);
    }
    fd.append("IsFolderInnerItem", IsFolderInnerItem);
    fd.append("ParentFolderId", ParentFolderId);
    fd.append("FullPath", FullPath == undefined ? "" : FullPath);
    fd.append("Type", Type);
    fd.append("YardMasterId", $('#hdnYardMasterID').val());
    fd.append("TabMasterId", $('#hdnTabMasterId').val());
    fd.append("TabType", TabType);
    fd.append("IsUploadDraft", $('#hdnIsUploadDraft').val());

    var xhr;
    if (window.XMLHttpRequest) {
        xhr = new XMLHttpRequest();
    }
    var RedttoURL = getUploadFilesURL();
    xhr.open("POST", RedttoURL, true);
    //xhr.upload.addEventListener("progress", HandleUploadProgress, false);
    xhr.onload = function (evt) {
        if (xhr.status === 200) {
            activeUploads -= 1;
            var result = JSON.parse(evt.target.responseText);
            if (result.ErrorType == -5) {
                ShowMessages(9);
            }
            else if (result.IsSuccess) {
                if (result.ItemType == 1) {
                    if (result.FolderId == -1) {
                        UpdatedFoldername = "/" + result.MSG;
                    }

                }
                //console.log("Item Uploaded Done: " + result.ItemName);
            }
            else {
                ErrorList.push(result);
                //console.log("Error: ", result);
            }
            UploadedInnerFolders += 1;
            TotalUploaded += 1;
            ChangeProgress(TotalUploaded);
            // Check if there are any uploads left in a queue:
            if (uploadsQueue.length) {
                var data = uploadsQueue.shift();
                SendInnersFolders(data.Item, data.FullPath, data.Type, data.ParentFolderId, data.IsFolderInnerItem);
            }
            if (UploadedInnerFolders == TotalInnerFolders) {
                //for (var k = 0; k < GlobalInnerFiles.length; k++) {
                //    var Item = GlobalInnerFiles[k];
                //    var ItemType = 2;
                //    var IsFolderInnerItem = true;
                //    SendSyncFiles(Item.fileObject, Item.fullPath, ItemType, ParentFolderId, IsFolderInnerItem);
                //}
                //for (var k = 0; k < GlobalFiles.length; k++) {
                //    var Item = GlobalFiles[k];
                //    var ItemType = 2;
                //    var IsFolderInnerItem = true;
                //    SendSyncFiles(Item.fileObject, Item.fullPath, ItemType, ParentFolderId, IsFolderInnerItem);
                //}
                AddUpdateUploadMasterwithFiles(GlobalFiles, false, 1);
            }
            if (TotalUploaded == TotalItemsUpload) {
                ResetTotalItemsCounter();
                ResetProgressBar();
                //console.log("Total Errors", ErrorList);
                if (ErrorList.length == 0) {
                    parent.$.fancybox.close();
                }
                else {
                    ShowErrorList(ErrorList);
                }
                ShowMessages(1);
                parent.document.getElementById('ifrmMainContainer').contentWindow.refreshcontrol();
            }

        }
        else {
            //console.log('Upload failed-OnSuccess: Status ', xhr.status);
            ShowMessages(2);
            //console.log("There was an error attempting to upload the file.");
        }
    }
    xhr.onerror = function (e) {
        //console.log("There was an error attempting to upload the file.");
        ShowMessages(2);
        //console.log('Upload failed-OnError: ', e);
    }
    xhr.onabort = function (e) {
        //console.log("The upload has been canceled by the user or the browser dropped the connection.");
        ShowMessages(3);
        //console.log('Upload failed-onabort: ', CurrentItemName);
    }
    xhr.withCredentials = true;
    xhr.send(fd);
}

function HandleUploadProgress(e) {
    /*if (e.lengthComputable) {
        //console.log(e, 'Process');
        var loaded = e.loaded;
        var total = e.total;

        //console.log("Loaded " + loaded + " Out Of " + total);
        //if (loaded == total) {
        //    console.log("Done " + e.total);
        //}

        var TotalFileSize = "";
        var processFileSize = "";

        SetProgressSingle(loaded, total);

        var percentageDone = parseInt(loaded / total * 100);
        var pcia = loaded / 1024;
        var pcia2 = total / 1024;
        if (pcia2 > 1024) {
            pcia = pcia / 1024
            pcia2 = pcia2 / 1024;
            TotalFileSize = Math.ceil(pcia2 * 100) / 100 + " MB";
            processFileSize = Math.ceil(pcia * 100) / 100 + " MB";
        }
        else {
            processFileSize = Math.ceil(pcia * 100) / 100 + " KB";
            TotalFileSize = Math.ceil(pcia2 * 100) / 100 + " KB";
        }


        //TotalLoadedBytes += e.loaded;
        var seconds_elapsed = (new Date().getTime() - currentFileStartTime.getTime()) / 1000;
        var bytes_per_second = seconds_elapsed ? loaded / seconds_elapsed : 0;
        var Kbytes_per_second = bytes_per_second / 1024;

        var seconds_remaining = TotalFilesSize / bytes_per_second;

        $("#lblFileSize").text(TotalFileSize);
        $("#lblUploadedPerc").text(percentageDone + "%");
        $("#lblUploadedFileSize").text("(" + processFileSize + ")");


        // Time Done
        var date = new Date(null);
        date.setSeconds((new Date().getTime() - startTime.getTime()) / 1000); // specify value for SECONDS here
        var result = date.toISOString().substr(11, 8);
        $("#lblElapsedTime").text(result);

        date.setSeconds(seconds_remaining); // specify value for SECONDS here
        result = date.toISOString().substr(11, 8);
        $("#lblEstimatedTime").text(result);

        if (Kbytes_per_second > 1024) {
            Kbytes_per_second = (Kbytes_per_second / 1024).toFixed(1);
            $("#lblUploadSpeed").text(Kbytes_per_second + "mB/s");
        }
        else {
            $("#lblUploadSpeed").text(Kbytes_per_second.toFixed(1) + "kB/s");
        }
    }*/
}

function ShowErrorList(ErrorList) {
    var objHtml = "";
    for (var j = 0; j < ErrorList.length; j++) {
        var obj = ErrorList[j];
        var errorDesc = GetErrorDesc(obj.ErrorType)
        objHtml += "<tr>";
        objHtml += "<td class='w6'><div><span class='red'></span></div></td>";
        objHtml += "<td class='w50'><div>" + obj.ItemName + "</div></td>";
        objHtml += "<td class='w41'><div>" + errorDesc + "</div></td>";
        objHtml += "</tr>";
    }
    $("#errorList").html(objHtml);
    $(".divErrorList").show();
}

function GetErrorDesc(ErrorCode) {
    var desc = "";
    if (ErrorCode == -1) {
        desc = "Folder Already Exists";
    }
    else if (ErrorCode == -2) {
        desc = "Something Went Wrong, Create Failure";
    }
    else if (ErrorCode == -3) {
        desc = "Max Length";
    }
    else if (ErrorCode == -4) {
        desc = "The file with the same name is locked in a draft mode by another user";
    }
    else if (ErrorCode == 0) {
        desc = "File Already Checked Out";
    }
    else if (ErrorCode == 1) {
        desc = "File Already Exists";
    }
    return desc;

}
//#endregion

//#region Get All Items Info
function SetTotalItemsCounter() {
    TotalItemsUpload = TotalFilesUpload + TotalFoldersUpload;
    //console.log(TotalItemsUpload, 'TotalItemsUpload');
    //console.log(TotalFilesUpload, 'TotalFilesUpload');
    //console.log(TotalFoldersUpload, 'TotalFoldersUpload');
}

function GetTotalFilesSize(files) {
    TotalFilesSize = 0;
    for (var i = 0; i < files.length; i++) {
        if (files[i] != undefined) {
            TotalFilesSize += files[i].size;
        }
    }
}
//#endregion

//#region Handle ProgressBar
var progressBarSingle = $("#progressbar_single");
var progressBarTotal = $("#progressbar_Total");
var lblTotalFiles = $("#lblTotalFiles");
var lblTotalUploadedFiles = $("#lblTotalUploadedFiles");
var lblTotalPerc = $("#lblTotalPerc");
var divProgress = $("#divProgress");

function SetProgressSingle(val, total) {
    //console.log(val, total, "ValueProgress");
    progressBarSingle.progressbar({
        value: val,
        max: total
    });
}

function SetProgress(val) {
    startTime = new Date();
    StartInterval();
    divProgress.show();
    progressBarTotal.progressbar({
        value: val,
        max: TotalItemsUpload
    });
    lblTotalFiles.text(TotalItemsUpload);
    lblTotalPerc.text(CalculatePercentage(val, TotalItemsUpload) + "%");
}

function ChangeProgress(val) {
    //console.log(val, TotalItemsUpload, "ValueProgress");
    //progressBarTotal.progressbar("value", val);
    progressBarTotal.progressbar({
        value: val,
        max: TotalItemsUpload
    });
    lblTotalFiles.text(TotalItemsUpload);
    lblTotalUploadedFiles.text("(" + val + ")");
    lblTotalPerc.text(CalculatePercentage(val, TotalItemsUpload) + "%");
}

function CalculatePercentage(n, Total) {
    var Per = (n * 100 / Total).toFixed(1);
    return Per;
}

function ResetProgressBar() {
    parent.$('#ctl00_ContentPlaceHolder1_hdnIsUploadDone').val('0');
    divProgress.hide();
    progressBarSingle.progressbar("destroy");
    progressBarTotal.progressbar("destroy");
    lblTotalFiles.text("");
    lblTotalUploadedFiles.text("");
    TotalItemsUpload = 0;
    TotalFilesUpload = 0;
    TotalFoldersUpload = 0;
    TotalUploaded = 0;
    TotalFilesSize = 0;
    StopInterval();
}

function ResetTotalItemsCounter() {
    TotalItemsUpload = 0;
    TotalFilesUpload = 0;
    TotalFoldersUpload = 0;
    TotalUploaded = 0;
    TotalFilesSize = 0;
    TempTotalSize = 0;
    activeUploads = 0;
    uploadsQueue = [];
    FoldersList = [];
    IsUploadingStart = false;
}

function StartInterval() {
    // Update the count down every 1 second
    Timer = setInterval(function () {
        var date = new Date(null);
        date.setSeconds((new Date().getTime() - startTime.getTime()) / 1000); // specify value for SECONDS here
        var result = date.toISOString().substr(11, 8);
        $("#lblElapsedTime").text(result);
    }, 1000);
}


function StopInterval() {
    clearInterval(Timer);
}

//$(document).ready(function () {
//    divProgress.show();
//    progressBarTotal.progressbar({
//        value: 40,
//        max: 100
//    });
//    //progressBarSingle.progressbar({
//    //    value: 40,
//    //    max: 100
//    //});
//});

//#endregion

//#region Loading
function fnStartLoading() {
    var overlay = '<div id="overlayLoadTab">' +
        '<img alt="Loading ..." src="../../Images/loading1.gif" title="Loading..." class="loadingactivity" />' +
        '</div>';
    $(overlay).appendTo('body');
}
function fnStopLoading() {
    $('#overlayLoadTab').remove();
}

//#endregion