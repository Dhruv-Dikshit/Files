/* ExtendScript side of the Scribble Studio panel: imports a finished export into the open project.
 * Premiere Pro → into a "Scribble Studio" bin.  After Effects → into a "Scribble Studio" folder.
 * `sequence` = true imports a folder of numbered PNGs as one clip (PNG sequence export). */

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

function scribbleImport(path, sequence) {
    try {
        var f = new File(path);
        if (!f.exists) return "error: file not found " + path;
        if (BridgeTalk.appName === "premierepro") {
            if (!app.project) return "error: open a project first";
            var ok = app.project.importFiles([f.fsName], true, scribbleBinPremiere(), sequence === true);
            return ok ? "ok " + f.name : "error: Premiere refused the file";
        }
        if (BridgeTalk.appName === "aftereffects") {
            var io = new ImportOptions(f);
            if (sequence === true && io.canImportAs(ImportAsType.FOOTAGE)) io.sequence = true;
            app.beginUndoGroup("Import Scribble Studio");
            var item = app.project.importFile(io);
            item.parentFolder = scribbleFolderAE();
            if (item.mainSource && item.mainSource.hasAlpha) item.mainSource.alphaMode = AlphaMode.STRAIGHT;
            // drop it into the active comp, if there is one
            var comp = app.project.activeItem;
            if (comp && comp instanceof CompItem) comp.layers.add(item);
            app.endUndoGroup();
            return "ok " + f.name;
        }
        return "error: unsupported app " + BridgeTalk.appName;
    } catch (e) {
        return "error: " + e.toString();
    }
}
