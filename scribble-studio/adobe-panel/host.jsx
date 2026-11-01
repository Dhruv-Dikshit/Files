/* ExtendScript side of the Scribble Studio panel: imports a finished export into the open project.
 *
 * Premiere Pro  → into a "Scribble Studio" bin, and (optionally) onto the active sequence at the
 *                 playhead, on the lowest video track above V1 that is free there.
 * After Effects → into a "Scribble Studio" folder, and (optionally) into the active comp at the
 *                 current time.
 * `sequence` = true imports a folder of numbered PNGs as one clip (PNG sequence export).
 * Returns "ok <message>" or "error: <message>".
 */

function scribbleBinPremiere() {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var it = root.children[i];
        if (it && it.name === "Scribble Studio" && it.type === ProjectItemType.BIN) return it;
    }
    return root.createBin("Scribble Studio");
}

function scribbleFolderAE() {
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof FolderItem && it.name === "Scribble Studio") return it;
    }
    return app.project.items.addFolder("Scribble Studio");
}

/* lowest video track above V1 with nothing under the playhead (adds to the top if all are busy) */
function scribbleFreeTrack(seq, t) {
    var tracks = seq.videoTracks;
    for (var i = 1; i < tracks.numTracks; i++) {
        var tr = tracks[i];
        var busy = false;
        for (var c = 0; c < tr.clips.numItems; c++) {
            var clip = tr.clips[c];
            if (clip.start.seconds <= t + 0.001 && clip.end.seconds > t + 0.001) { busy = true; break; }
        }
        if (!busy && !tr.isLocked()) return tr;
    }
    return tracks[tracks.numTracks - 1];
}

function scribbleImportPremiere(f, sequence, place) {
    if (!app.project) return "error: open a project first";
    var bin = scribbleBinPremiere();
    var before = bin.children.numItems;
    var ok = app.project.importFiles([f.fsName], true, bin, sequence === true);
    if (!ok) return "error: Premiere refused the file";
    var item = bin.children.numItems > before ? bin.children[bin.children.numItems - 1] : null;
    if (!place) return "ok imported to the Scribble Studio bin";
    var seq = app.project.activeSequence;
    if (!seq) return "ok imported to the bin (open a sequence to place it on the timeline)";
    if (!item) return "ok imported to the bin";
    var t = seq.getPlayerPosition().seconds;
    var track = scribbleFreeTrack(seq, t);
    track.overwriteClip(item, t);
    return "ok placed on the timeline at the playhead";
}

function scribbleImportAE(f, sequence, place) {
    var io = new ImportOptions(f);
    if (sequence === true && io.canImportAs(ImportAsType.FOOTAGE)) io.sequence = true;
    app.beginUndoGroup("Import Scribble Studio");
    var item = app.project.importFile(io);
    item.parentFolder = scribbleFolderAE();
    try {
        if (item.mainSource && item.mainSource.hasAlpha) item.mainSource.alphaMode = AlphaMode.STRAIGHT;
    } catch (e) { /* not footage with alpha */ }
    var msg = "ok imported to the Scribble Studio folder";
    var comp = app.project.activeItem;
    if (place && comp && comp instanceof CompItem) {
        var layer = comp.layers.add(item);
        layer.startTime = comp.time;
        msg = "ok added to " + comp.name + " at the current time";
    }
    app.endUndoGroup();
    return msg;
}

function scribbleImport(path, sequence, place) {
    try {
        var f = new File(path);
        if (!f.exists) return "error: file not found " + path;
        if (BridgeTalk.appName === "premierepro") return scribbleImportPremiere(f, sequence, place);
        if (BridgeTalk.appName === "aftereffects") return scribbleImportAE(f, sequence, place);
        return "error: unsupported app " + BridgeTalk.appName;
    } catch (e) {
        return "error: " + e.toString();
    }
}

function scribbleHostName() {
    return BridgeTalk.appName;
}
