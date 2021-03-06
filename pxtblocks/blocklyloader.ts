/// <reference path="../built/blockly.d.ts" />
/// <reference path="../built/pxtlib.d.ts" />
import Util = pxt.Util;

let lf = Util.lf;

namespace pxt.blocks {

    const blockColors: Map<number> = {
        loops: 120,
        images: 45,
        variables: 330,
        text: 160,
        lists: 260,
        math: 230,
        logic: 210
    }

    // list of built-in blocks, should be touched.
    const builtinBlocks: Map<{
        block: B.BlockDefinition;
        symbol?: pxtc.SymbolInfo;
    }> = {};
    Object.keys(Blockly.Blocks)
        .forEach(k => builtinBlocks[k] = { block: Blockly.Blocks[k] });

    // blocks cached
    interface CachedBlock {
        hash: string;
        fn: pxtc.SymbolInfo;
        block: Blockly.BlockDefinition;
    }
    let cachedBlocks: Map<CachedBlock> = {};
    let cachedToolbox: string = "";

    export function blockSymbol(type: string): pxtc.SymbolInfo {
        let b = cachedBlocks[type];
        return b ? b.fn : undefined;
    }

    function createShadowValue(name: string, type: string, v?: string, shadowType?: string): Element {
        if (v && v.slice(0, 1) == "\"")
            v = JSON.parse(v);
        if (type == "number" && shadowType && shadowType == "value") {
            let field = document.createElement("field");
            field.setAttribute("name", name);
            field.appendChild(document.createTextNode("0"));
            return field;
        }

        let value = document.createElement("value");
        value.setAttribute("name", name);

        let shadowTypeType = shadowType == "variables_get" ? "block" : "shadow";
        let shadow = document.createElement(shadowTypeType); value.appendChild(shadow);
        shadow.setAttribute("type", shadowType ? shadowType : type == "number" ? "math_number" : type == "string" ? "text" : type);
        if (type == "number" || type == "string") {
            let field = document.createElement("field"); shadow.appendChild(field);
            field.setAttribute("name", shadowType == "variables_get" ? "VAR" : type == "number" ? "NUM" : "TEXT");
            field.appendChild(document.createTextNode(v || (type == "number" ? "0" : "")));
        }
        return value;
    }

    export interface BlockParameter {
        name: string;
        type?: string;
        shadowType?: string;
        shadowValue?: string;
    }

    export function parameterNames(fn: pxtc.SymbolInfo): Map<BlockParameter> {
        // collect blockly parameter name mapping
        const instance = fn.kind == pxtc.SymbolKind.Method || fn.kind == pxtc.SymbolKind.Property;
        let attrNames: Map<BlockParameter> = {};

        if (instance) attrNames["this"] = { name: "this", type: fn.namespace };
        if (fn.parameters)
            fn.parameters.forEach(pr => attrNames[pr.name] = {
                name: pr.name,
                type: pr.type,
                shadowValue: pr.defaults ? pr.defaults[0] : undefined
            });
        if (fn.attributes.block) {
            Object.keys(attrNames).forEach(k => attrNames[k].name = "");
            let rx = /%([a-zA-Z0-9_]+)(=([a-zA-Z0-9_]+))?/g;
            let m: RegExpExecArray;
            let i = 0;
            while (m = rx.exec(fn.attributes.block)) {
                if (i == 0 && instance) {
                    attrNames["this"].name = m[1];
                    if (m[3]) attrNames["this"].shadowType = m[3];
                    m = rx.exec(fn.attributes.block); if (!m) break;
                }

                let at = attrNames[fn.parameters[i++].name];
                at.name = m[1];
                if (m[3]) at.shadowType = m[3];
            }
        }
        return attrNames;
    }

    function createToolboxBlock(info: pxtc.BlocksInfo, fn: pxtc.SymbolInfo, attrNames: Map<BlockParameter>): HTMLElement {
        //
        // toolbox update
        //
        let block = document.createElement("block");
        block.setAttribute("type", fn.attributes.blockId);
        if (fn.attributes.blockGap)
            block.setAttribute("gap", fn.attributes.blockGap);
        if ((fn.kind == pxtc.SymbolKind.Method || fn.kind == pxtc.SymbolKind.Property)
            && attrNames["this"]) {
            let attr = attrNames["this"];
            block.appendChild(createShadowValue(attr.name, attr.type, attr.shadowValue || attr.name, attr.shadowType || "variables_get"));
        }
        if (fn.parameters)
            fn.parameters.filter(pr => !!attrNames[pr.name].name &&
                (/^(string|number)$/.test(attrNames[pr.name].type)
                    || !!attrNames[pr.name].shadowType
                    || !!attrNames[pr.name].shadowValue))
                .forEach(pr => {
                    let attr = attrNames[pr.name];
                    block.appendChild(createShadowValue(attr.name, attr.type, attr.shadowValue, attr.shadowType));
                })
        return block;
    }

    function injectToolbox(tb: Element, info: pxtc.BlocksInfo, fn: pxtc.SymbolInfo, block: HTMLElement) {
        // identity function are just a trick to get an enum drop down in the block
        // while allowing the parameter to be a number
        if (fn.attributes.shim == "TD_ID")
            return;

        let ns = (fn.attributes.blockNamespace || fn.namespace).split('.')[0];
        let nsn = info.apis.byQName[ns];
        if (nsn) ns = nsn.attributes.block || ns;
        let catName = Util.capitalize(ns)
        let category = categoryElement(tb, catName);
        if (!category) {
            pxt.debug('toolbox: adding category ' + ns)
            category = document.createElement("category");
            category.setAttribute("name", catName)
            let nsWeight = (nsn ? nsn.attributes.weight : 50) || 50;
            category.setAttribute("weight", nsWeight.toString())
            if (nsn && nsn.attributes.color) category.setAttribute("colour", nsn.attributes.color)
            else if (blockColors[ns]) category.setAttribute("colour", blockColors[ns].toString());
            // find the place to insert the category        
            let categories = tb.querySelectorAll("category");
            let ci = 0;
            for (ci = 0; ci < categories.length; ++ci) {
                let cat = categories.item(ci);
                if (parseInt(cat.getAttribute("weight") || "50") < nsWeight) {
                    tb.insertBefore(category, cat);
                    break;
                }
            }
            if (ci == categories.length)
                tb.appendChild(category);
        }
        category.appendChild(block);
    }

    let iconCanvasCache: Map<HTMLCanvasElement> = {};
    function iconToFieldImage(c: string): Blockly.FieldImage {
        let canvas = iconCanvasCache[c];
        if (!canvas) {
            canvas = iconCanvasCache[c] = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            let ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.font = "56px Icons";
            ctx.textAlign = "center";
            ctx.fillText(c, canvas.width / 2, 56);
        }
        return new Blockly.FieldImage(canvas.toDataURL(), 16, 16, '');
    }

    function injectBlockDefinition(info: pxtc.BlocksInfo, fn: pxtc.SymbolInfo, attrNames: Map<BlockParameter>, blockXml: HTMLElement): boolean {
        let id = fn.attributes.blockId;

        if (builtinBlocks[id]) {
            pxt.reportError('trying to override builtin block ' + id, null);
            return false;
        }

        let hash = JSON.stringify(fn);
        if (cachedBlocks[id] && cachedBlocks[id].hash == hash) {
            return true;
        }

        if (Blockly.Blocks[fn.attributes.blockId]) {
            console.error("duplicate block definition: " + id);
            return false;
        }

        let cachedBlock: CachedBlock = {
            hash: hash,
            fn: fn,
            block: {
                codeCard: mkCard(fn, blockXml),
                init: function () { initBlock(this, info, fn, attrNames) }
            }
        }

        cachedBlocks[id] = cachedBlock;
        Blockly.Blocks[id] = cachedBlock.block;

        return true;
    }

    function initField(i: any, ni: number, fn: pxtc.SymbolInfo, pre: string, right?: boolean, type?: string): any {
        if (ni == 0 && fn.attributes.icon)
            i.appendField(iconToFieldImage(fn.attributes.icon))
        if (pre)
            i.appendField(pre);
        if (right)
            i.setAlign(Blockly.ALIGN_RIGHT)
        // ignore generic types
        if (type && type != "T")
            i.setCheck(type);
        return i;
    }

    function cleanOuterHTML(el: HTMLElement): string {
        // remove IE11 junk
        return el.outerHTML.replace(/^<\?[^>]*>/, '');
    }

    function mkCard(fn: pxtc.SymbolInfo, blockXml: HTMLElement): pxt.CodeCard {
        let xml = blockXml.outerHTML
            // remove IE11
            .replace(/^<\?[^>]*>/, '');
        return {
            name: fn.namespace + '.' + fn.name,
            description: fn.attributes.jsDoc,
            url: fn.attributes.help ? 'reference/' + fn.attributes.help.replace(/^\//, '') : undefined,
            blocksXml: `<xml xmlns="http://www.w3.org/1999/xhtml">${cleanOuterHTML(blockXml)}</xml>`,
        }
    }

    function initBlock(block: any, info: pxtc.BlocksInfo, fn: pxtc.SymbolInfo, attrNames: Map<BlockParameter>) {
        const ns = (fn.attributes.blockNamespace || fn.namespace).split('.')[0];
        const instance = fn.kind == pxtc.SymbolKind.Method || fn.kind == pxtc.SymbolKind.Property;
        const nsinfo = info.apis.byQName[ns];

        if (fn.attributes.help)
            block.setHelpUrl("/reference/" + fn.attributes.help.replace(/^\//, ''));

        block.setTooltip(fn.attributes.jsDoc);
        block.setColour(
            fn.attributes.color
            || (nsinfo ? nsinfo.attributes.color : undefined)
            || blockColors[ns]
            || 255);

        fn.attributes.block.split('|').map((n, ni) => {
            let m = /([^%]*)\s*%([a-zA-Z0-9_]+)/.exec(n);
            let i: any;
            if (!m) {
                i = initField(block.appendDummyInput(), ni, fn, n);
            } else {
                // find argument
                let pre = m[1]; if (pre) pre = pre.trim();
                let p = m[2];
                let n = Object.keys(attrNames).filter(k => attrNames[k].name == p)[0];
                if (!n) {
                    console.error("block " + fn.attributes.blockId + ": unkown parameter " + p);
                    return;
                }
                let pr = attrNames[n];
                if (/\[\]$/.test(pr.type)) { // Array type
                    i = initField(block.appendValueInput(p), ni, fn, pre, true, "Array");
                } else if (instance && n == "this") {
                    i = initField(block.appendValueInput(p), ni, fn, pre, true, pr.type);
                } else if (pr.type == "number") {
                    if (pr.shadowType && pr.shadowType == "value") {
                        i = block.appendDummyInput();
                        if (pre) i.appendField(pre)
                        i.appendField(new Blockly.FieldTextInput("0", Blockly.FieldTextInput.numberValidator), p);
                    }
                    else i = initField(block.appendValueInput(p), ni, fn, pre, true, "Number");
                }
                else if (pr.type == "boolean") {
                    i = initField(block.appendValueInput(p), ni, fn, pre, true, "Boolean");
                } else if (pr.type == "string") {
                    i = initField(block.appendValueInput(p), ni, fn, pre, true, "String");
                } else {
                    let prtype = Util.lookup(info.apis.byQName, pr.type);
                    if (prtype && prtype.kind == pxtc.SymbolKind.Enum) {
                        let dd = Util.values(info.apis.byQName)
                            .filter(e => e.namespace == pr.type)
                            .map(v => [v.attributes.block || v.attributes.blockId || v.name, v.namespace + "." + v.name]);
                        i = initField(block.appendDummyInput(), ni, fn, pre, true);
                        i.appendField(new Blockly.FieldDropdown(dd), attrNames[n].name);
                    } else {
                        i = initField(block.appendValueInput(p), ni, fn, pre, true, pr.type);
                    }
                }
            }
        });

        let body = fn.parameters ? fn.parameters.filter(pr => pr.type == "() => void")[0] : undefined;
        if (body) {
            block.appendStatementInput("HANDLER")
                .setCheck("null");
        }

        if (fn.attributes.imageLiteral) {
            for (let r = 0; r < 5; ++r) {
                let ri = block.appendDummyInput();
                for (let c = 0; c < fn.attributes.imageLiteral * 5; ++c) {
                    if (c > 0 && c % 5 == 0) ri.appendField("  ");
                    else if (c > 0) ri.appendField(" ");
                    ri.appendField(new Blockly.FieldCheckbox("FALSE"), "LED" + c + r);
                }
            }
        }

        block.setInputsInline(!fn.attributes.blockExternalInputs && fn.parameters.length < 4 && !fn.attributes.imageLiteral);

        switch (fn.retType) {
            case "number": block.setOutput(true, "Number"); break;
            case "string": block.setOutput(true, "String"); break;
            case "boolean": block.setOutput(true, "Boolean"); break;
            case "void": break; // do nothing
            //TODO
            default: block.setOutput(true, fn.retType);
        }

        // hook up/down if return value is void
        block.setPreviousStatement(fn.retType == "void");
        block.setNextStatement(fn.retType == "void");

        block.setTooltip(fn.attributes.jsDoc);
    }

    function removeCategory(tb: Element, name: string) {
        let e = categoryElement(tb, name);
        if (e && e.parentElement)
            e.parentElement.removeChild(e);
    }

    export function initBlocks(blockInfo: pxtc.BlocksInfo, workspace?: Blockly.Workspace, toolbox?: Element): void {
        init();

        // create new toolbox and update block definitions
        let tb = toolbox ? <Element>toolbox.cloneNode(true) : undefined;
        blockInfo.blocks.sort((f1, f2) => {
            let ns1 = blockInfo.apis.byQName[f1.namespace.split('.')[0]];
            let ns2 = blockInfo.apis.byQName[f2.namespace.split('.')[0]];
            if (ns1 && !ns2) return -1; if (ns2 && !ns1) return 1;
            let c = 0;
            if (ns1 && ns2) {
                c = (ns2.attributes.weight || 50) - (ns1.attributes.weight || 50);
                if (c != 0) return c;
            }
            c = (f2.attributes.weight || 50) - (f1.attributes.weight || 50);
            return c;
        })

        let currentBlocks: Map<number> = {};
        const dbg = pxt.options.debug;
        // create new toolbox and update block definitions
        blockInfo.blocks
            .filter(fn => !tb || !tb.querySelector(`block[type='${fn.attributes.blockId}']`))
            .forEach(fn => {
                if (fn.attributes.blockBuiltin) {
                    Util.assert(!!builtinBlocks[fn.attributes.blockId]);
                    builtinBlocks[fn.attributes.blockId].symbol = fn;
                } else {
                    let pnames = parameterNames(fn);
                    let block = createToolboxBlock(blockInfo, fn, pnames);
                    if (injectBlockDefinition(blockInfo, fn, pnames, block)) {
                        if (tb && (!fn.attributes.debug || dbg))
                            injectToolbox(tb, blockInfo, fn, block);
                        currentBlocks[fn.attributes.blockId] = 1;
                    }
                }
            })

        // remove ununsed blocks
        Object
            .keys(cachedBlocks).filter(k => !currentBlocks[k])
            .forEach(k => removeBlock(cachedBlocks[k].fn));

        // remove unused categories
        let config = pxt.appTarget.runtime || {};
        if (!config.mathBlocks) removeCategory(tb, "Math");
        if (!config.textBlocks) removeCategory(tb, "Text");
        if (!config.listsBlocks) removeCategory(tb, "Lists");
        if (!config.variablesBlocks) removeCategory(tb, "Variables");
        if (!config.logicBlocks) removeCategory(tb, "Logic");
        if (!config.loopsBlocks) removeCategory(tb, "Loops");

        // Load localized names for default categories
        if (tb) {
            let cats = tb.querySelectorAll('category');
            for (let i = 0; i < cats.length; i++) {
                cats[i].setAttribute('name',
                    Util._localize(cats[i].getAttribute('name')));
            }
        }

        // Do not remove this comment.
        // These are used for category names.
        // lf("{id:category}Loops")
        // lf("{id:category}Logic")
        // lf("{id:category}Variables")
        // lf("{id:category}Lists")
        // lf("{id:category}Text")
        // lf("{id:category}Math")

        // add extra blocks
        if (tb && pxt.appTarget.runtime && pxt.appTarget.runtime.extraBlocks) {
            pxt.appTarget.runtime.extraBlocks.forEach(eb => {
                let cat = categoryElement(tb, eb.namespace);
                if (cat) {
                    let el = document.createElement("block");
                    el.setAttribute("type", eb.type);
                    el.setAttribute("weight", (eb.weight || 50).toString());
                    if (eb.gap) el.setAttribute("gap", eb.gap.toString());
                    if (eb.fields) {
                        for (let f in eb.fields) {
                            let fe = document.createElement("field");
                            fe.setAttribute("name", f);
                            fe.appendChild(document.createTextNode(eb.fields[f]));
                            el.appendChild(fe);
                        }
                    }
                    cat.appendChild(el);
                } else {
                    console.error(`trying to add block ${eb.type} to unknown category ${eb.namespace}`)
                }
            })
        }

        // update shadow types
        if (tb) {
            $(tb).find('shadow:empty').each((i, shadow) => {
                let type = shadow.getAttribute('type');
                let b = $(tb).find(`block[type="${type}"]`)[0];
                if (b) shadow.innerHTML = b.innerHTML;
            })

            // update toolbox   
            if (tb.innerHTML != cachedToolbox && workspace) {
                cachedToolbox = tb.innerHTML;
                workspace.updateToolbox(tb)
            }
        }
    }

    function categoryElement(tb: Element, name: string): Element {
        return tb ? tb.querySelector(`category[name="${Util.capitalize(name)}"]`) : undefined;
    }

    export function cleanBlocks() {
        pxt.debug('removing all custom blocks')
        for (let b in cachedBlocks)
            removeBlock(cachedBlocks[b].fn);
    }

    function removeBlock(fn: pxtc.SymbolInfo) {
        delete Blockly.Blocks[fn.attributes.blockId];
        delete cachedBlocks[fn.attributes.blockId];
    }

    let blocklyInitialized = false;
    function init() {
        if (blocklyInitialized) return;
        blocklyInitialized = true;

        goog.provide('Blockly.Blocks.device');
        goog.require('Blockly.Blocks');

        if (window.navigator.pointerEnabled) {
            (Blockly.bindEvent_ as any).TOUCH_MAP = {
                mousedown: 'pointerdown',
                mousemove: 'pointermove',
                mouseup: 'pointerup'
            };
            document.body.style.touchAction = 'none';
        }

        Blockly.FieldCheckbox.CHECK_CHAR = '■';

        initContextMenu();
        initMath();
        initVariables();
        initLoops();
        initLogic();
        initText();

        // hats creates issues when trying to round-trip events between JS and blocks. To better support that scenario,
        // we're taking off hats.
        // Blockly.BlockSvg.START_HAT = true;
    }

    function setHelpResources(block: any, id: string, name: string, tooltip: any, url: string) {
        if (tooltip) block.setTooltip(tooltip);
        if (url) block.setHelpUrl(url);

        let tb = document.getElementById('blocklyToolboxDefinition');
        let xml: HTMLElement = tb ? tb.querySelector(`category block[type~='${id}']`) as HTMLElement : undefined;
        block.codeCard = <pxt.CodeCard>{
            header: name,
            name: name,
            software: 1,
            description: goog.isFunction(tooltip) ? tooltip() : tooltip,
            blocksXml: xml ? (`<xml xmlns="http://www.w3.org/1999/xhtml">` + (cleanOuterHTML(xml) || `<block type="${id}"</block>`) + "</xml>") : undefined,
            url: url
        };
    }

    function installHelpResources(id: string, name: string, tooltip: any, url: string) {
        let block = Blockly.Blocks[id];
        let old = block.init;
        if (!old) return;

        block.init = function () {
            old.call(this);
            let block = this;
            setHelpResources(this, id, name, goog.isFunction(tooltip) ? function () { return tooltip(block); } : tooltip, url);
        }
    }

    function initLoops() {
        let msg: any = Blockly.Msg;

        // builtin controls_repeat_ext
        msg.CONTROLS_REPEAT_TITLE = lf("repeat %1 times");
        msg.CONTROLS_REPEAT_INPUT_DO = lf("{id:repeat}do");
        installHelpResources(
            'controls_repeat_ext',
            lf("a loop that repeats and increments an index"),
            lf("Do some statements several times."),
            '/blocks/loops/repeat'
        );

        // pxt device_while
        Blockly.Blocks['device_while'] = {
            init: function () {
                this.jsonInit({
                    "message0": lf("while %1"),
                    "args0": [
                        {
                            "type": "input_value",
                            "name": "COND",
                            "check": "Boolean"
                        }
                    ],
                    "previousStatement": null,
                    "nextStatement": null,
                    "colour": blockColors['loops']
                });
                this.appendStatementInput("DO")
                    .appendField(lf("{id:while}do"));

                setHelpResources(this,
                    'device_while',
                    lf("a loop that repeats while the condition is true"),
                    lf("Run the same sequence of actions while the condition is met."),
                    '/blocks/loops/while'
                );
            }
        };

        // pxt controls_simple_for
        Blockly.Blocks['controls_simple_for'] = {
            /**
             * Block for 'for' loop.
             * @this Blockly.Block
             */
            init: function () {
                this.jsonInit({
                    "message0": lf("for %1 from 0 to %2"),
                    "args0": [
                        {
                            "type": "field_variable",
                            "name": "VAR",
                            "variable": lf("{id:var}item")
                            // Please note that most multilingual characters
                            // cannot be used as variable name at this point.
                            // Translate or decide the default variable name
                            // with care.
                        },
                        {
                            "type": "input_value",
                            "name": "TO",
                            "check": "Number"
                        }
                    ],
                    "previousStatement": null,
                    "nextStatement": null,
                    "colour": blockColors['loops'],
                    "inputsInline": true
                });
                this.appendStatementInput('DO')
                    .appendField(lf("{id:for}do"));

                let thisBlock = this;
                setHelpResources(this,
                    'controls_simple_for',
                    lf("a loop that repeats the number of times you say"),
                    function () {
                        return lf("Have the variable '{0}' take on the values from 0 to the end number, counting by 1, and do the specified blocks.", thisBlock.getFieldValue('VAR'));
                    },
                    '/blocks/loops/for'
                );
            },
            /**
             * Return all variables referenced by this block.
             * @return {!Array.<string>} List of variable names.
             * @this Blockly.Block
             */
            getVars: function (): any[] {
                return [this.getFieldValue('VAR')];
            },
            /**
             * Notification that a variable is renaming.
             * If the name matches one of this block's variables, rename it.
             * @param {string} oldName Previous name of variable.
             * @param {string} newName Renamed variable.
             * @this Blockly.Block
             */
            renameVar: function (oldName: string, newName: string) {
                if (Blockly.Names.equals(oldName, this.getFieldValue('VAR'))) {
                    this.setFieldValue(newName, 'VAR');
                }
            },
            /**
             * Add menu option to create getter block for loop variable.
             * @param {!Array} options List of menu options to add to.
             * @this Blockly.Block
             */
            customContextMenu: function (options: any[]) {
                if (!this.isCollapsed()) {
                    let option: any = { enabled: true };
                    let name = this.getFieldValue('VAR');
                    option.text = lf("Create 'get {0}'", name);
                    let xmlField = goog.dom.createDom('field', null, name);
                    xmlField.setAttribute('name', 'VAR');
                    let xmlBlock = goog.dom.createDom('block', null, xmlField);
                    xmlBlock.setAttribute('type', 'variables_get');
                    option.callback = Blockly.ContextMenu.callbackFactory(this, xmlBlock);
                    options.push(option);
                }
            }
        };
    }

    export var onShowContextMenu: (workspace: Blockly.Workspace,
        items: Blockly.ContextMenu.MenuItem[]) => void = undefined;

    // TODO: port changes to blockly 
    export function initMouse(ws: Blockly.Workspace) {
        Blockly.bindEvent_(ws.svgGroup_, 'wheel', ws, ev => {
            let e = ev as WheelEvent;
            Blockly.terminateDrag_();
            const delta = e.deltaY > 0 ? -1 : 1;
            const position = Blockly.mouseToSvg(e, ws.getParentSvg());
            if (e.ctrlKey || e.metaKey)
                ws.zoom(position.x, position.y, delta);
            else if (ws.scrollbar) {
                let y = parseFloat(ws.scrollbar.vScroll.svgKnob_.getAttribute("y") || "0");
                y /= ws.scrollbar.vScroll.ratio_;
                ws.scrollbar.vScroll.set(y + e.deltaY);
                ws.scrollbar.resize();
            }
            e.preventDefault();
        });
    }

    function initContextMenu() {
        // Translate the context menu for blocks.
        let msg: any = Blockly.Msg;
        msg.DUPLICATE_BLOCK = lf("{id:block}Duplicate");
        msg.REMOVE_COMMENT = lf("Remove Comment");
        msg.ADD_COMMENT = lf("Add Comment");
        msg.EXTERNAL_INPUTS = lf("External Inputs");
        msg.INLINE_INPUTS = lf("Inline Inputs");
        msg.EXPAND_BLOCK = lf("Expand Block");
        msg.COLLAPSE_BLOCK = lf("Collapse Block");
        msg.ENABLE_BLOCK = lf("Enable Block");
        msg.DISABLE_BLOCK = lf("Disable Block");
        msg.DELETE_BLOCK = lf("Delete Block");
        msg.DELETE_X_BLOCKS = lf("Delete %1 Blocks");
        msg.HELP = "Help";

        /**
         * Show the context menu for the workspace.
         * @param {!Event} e Mouse event.
         * @private
         */
        (<any>Blockly).WorkspaceSvg.prototype.showContextMenu_ = function (e: any) {
            if (this.options.readOnly || this.isFlyout) {
                return;
            }
            let menuOptions: Blockly.ContextMenu.MenuItem[] = [];
            let topBlocks = this.getTopBlocks(true);
            let eventGroup = Blockly.genUid();

            // Options to undo/redo previous action.
            let undoOption: any = {};
            undoOption.text = lf("Undo");
            undoOption.enabled = this.undoStack_.length > 0;
            undoOption.callback = this.undo.bind(this, false);
            menuOptions.push(undoOption);
            let redoOption: any = {};
            redoOption.text = lf("Redo");
            redoOption.enabled = this.redoStack_.length > 0;
            redoOption.callback = this.undo.bind(this, true);
            menuOptions.push(redoOption);

            // Add a little animation to collapsing and expanding.
            const DELAY = 10;
            if (this.options.collapse) {
                let hasCollapsedBlocks = false;
                let hasExpandedBlocks = false;
                for (let i = 0; i < topBlocks.length; i++) {
                    let block = topBlocks[i];
                    while (block) {
                        if (block.isCollapsed()) {
                            hasCollapsedBlocks = true;
                        } else {
                            hasExpandedBlocks = true;
                        }
                        block = block.getNextBlock();
                    }
                }

                /**
                 * Option to collapse or expand top blocks.
                 * @param {boolean} shouldCollapse Whether a block should collapse.
                 * @private
                 */
                let toggleOption = function (shouldCollapse: boolean) {
                    let ms = 0;
                    for (let i = 0; i < topBlocks.length; i++) {
                        let block = topBlocks[i];
                        while (block) {
                            setTimeout(block.setCollapsed.bind(block, shouldCollapse), ms);
                            block = block.getNextBlock();
                            ms += DELAY;
                        }
                    }
                };

                // Option to collapse top blocks.
                let collapseOption: any = { enabled: hasExpandedBlocks };
                collapseOption.text = lf("Collapse Blocks");
                collapseOption.callback = function () {
                    toggleOption(true);
                };
                menuOptions.push(collapseOption);

                // Option to expand top blocks.
                let expandOption: any = { enabled: hasCollapsedBlocks };
                expandOption.text = lf("Expand Blocks");
                expandOption.callback = function () {
                    toggleOption(false);
                };
                menuOptions.push(expandOption);
            }

            // Option to delete all blocks.
            // Count the number of blocks that are deletable.
            let deleteList: any[] = [];
            function addDeletableBlocks(block: any) {
                if (block.isDeletable()) {
                    deleteList = deleteList.concat(block.getDescendants());
                } else {
                    let children = block.getChildren();
                    for (let i = 0; i < children.length; i++) {
                        addDeletableBlocks(children[i]);
                    }
                }
            }
            for (let i = 0; i < topBlocks.length; i++) {
                addDeletableBlocks(topBlocks[i]);
            }

            function deleteNext() {
                (<any>Blockly).Events.setGroup(eventGroup);
                let block = deleteList.shift();
                if (block) {
                    if (block.workspace) {
                        block.dispose(false, true);
                        setTimeout(deleteNext, DELAY);
                    } else {
                        deleteNext();
                    }
                }
                Blockly.Events.setGroup(false);
            }

            let deleteOption = {
                text: deleteList.length == 1 ? lf("Delete Block") :
                    lf("Delete {0} Blocks", deleteList.length),
                enabled: deleteList.length > 0,
                callback: function () {
                    if (deleteList.length < 2 ||
                        window.confirm(lf("Delete all {0} blocks?", deleteList.length))) {
                        deleteNext();
                    }
                }
            };
            menuOptions.push(deleteOption);

            let shuffleOption = {
                text: lf("Shuffle Blocks"),
                enabled: topBlocks.length > 0,
                callback: () => {
                    pxt.blocks.layout.shuffle(this, 1);
                }
            };
            menuOptions.push(shuffleOption);

            let screenshotOption = {
                text: lf("Download Screenshot"),
                enabled: topBlocks.length > 0,
                callback: () => {
                    pxt.blocks.layout.screenshotAsync(this)
                    .then((uri) => {
                        if (pxt.BrowserUtils.isSafari())
                            uri = uri.replace(/^data:image\/[^;]/, 'data:application/octet-stream');
                        BrowserUtils.browserDownloadDataUri(
                            uri,
                            `${pxt.appTarget.id}-${lf("screenshot")}.png`);
                    });
                }
            };
            menuOptions.push(screenshotOption);

            // custom options...
            if (onShowContextMenu)
                onShowContextMenu(this, menuOptions);

            Blockly.ContextMenu.show(e, menuOptions, this.RTL);
        };


    }

    function initMath() {
        // pxt math_op2
        Blockly.Blocks['math_op2'] = {
            init: function () {
                this.jsonInit({
                    "message0": lf("%1 of %2 and %3"),
                    "args0": [
                        {
                            "type": "field_dropdown",
                            "name": "op",
                            "options": [
                                [lf("{id:op}min"), "min"],
                                [lf("{id:op}max"), "max"]
                            ]
                        },
                        {
                            "type": "input_value",
                            "name": "x",
                            "check": "Number"
                        },
                        {
                            "type": "input_value",
                            "name": "y",
                            "check": "Number"
                        }
                    ],
                    "inputsInline": true,
                    "output": "Number",
                    "colour": blockColors['math']
                });

                let thisBlock = this;
                setHelpResources(this,
                    'math_op2',
                    lf("minimum or maximum of 2 numbers"),
                    function () {
                        return thisBlock.getFieldValue('op') == 'min' ? lf("smaller value of 2 numbers") : lf("larger value of 2 numbers");
                    },
                    '/blocks/math'
                );
            }
        };

        // pxt math_op3
        Blockly.Blocks['math_op3'] = {
            init: function () {
                this.jsonInit({
                    "message0": lf("absolute of %1"),
                    "args0": [
                        {
                            "type": "input_value",
                            "name": "x",
                            "check": "Number"
                        }
                    ],
                    "inputsInline": true,
                    "output": "Number",
                    "colour": blockColors['math']
                });

                setHelpResources(this,
                    'math_op3',
                    lf("absolute number"),
                    lf("absolute value of a number"),
                    '/blocks/math/abs'
                );
            }
        };

        // pxt device_random
        Blockly.Blocks['device_random'] = {
            init: function () {
                this.jsonInit({
                    "message0": lf("pick random 0 to %1"),
                    "args0": [
                        {
                            "type": "input_value",
                            "name": "limit",
                            "check": "Number"
                        }
                    ],
                    "inputsInline": true,
                    "output": "Number",
                    "colour": blockColors['math']
                });

                setHelpResources(this,
                    'device_random',
                    lf("pick random number"),
                    lf("Returns a random integer between 0 and the specified bound (inclusive)."),
                    '/blocks/math/random'
                );
            }
        };

        // builtin math_number
        //XXX Integer validation needed.
        installHelpResources(
            'math_number',
            lf("{id:block}number"),
            (pxt.appTarget.compile && pxt.appTarget.compile.floatingPoint) ? lf("a decimal number") : lf("an integer number"),
            '/blocks/math/random'
        );

        // builtin math_arithmetic
        let msg: any = Blockly.Msg;
        msg.MATH_ADDITION_SYMBOL = lf("{id:op}+");
        msg.MATH_SUBTRACTION_SYMBOL = lf("{id:op}-");
        msg.MATH_MULTIPLICATION_SYMBOL = lf("{id:op}×");
        msg.MATH_DIVISION_SYMBOL = lf("{id:op}÷");
        msg.MATH_POWER_SYMBOL = lf("{id:op}^");

        let TOOLTIPS: any = {
            'ADD': lf("Return the sum of the two numbers."),
            'MINUS': lf("Return the difference of the two numbers."),
            'MULTIPLY': lf("Return the product of the two numbers."),
            'DIVIDE': lf("Return the quotient of the two numbers."),
            'POWER': lf("Return the first number raised to the power of the second number."),
        };
        installHelpResources(
            'math_arithmetic',
            lf("arithmetic operation"),
            function (block: any) {
                return TOOLTIPS[block.getFieldValue('OP')];
            },
            '/blocks/math'
        );

        // builtin math_modulo
        msg.MATH_MODULO_TITLE = lf("remainder of %1 ÷ %2");
        installHelpResources(
            'math_modulo',
            lf("division remainder"),
            lf("Return the remainder from dividing the two numbers."),
            '/blocks/math'
        );
    }

    function initVariables() {
        let varname = lf("{id:var}item");
        Blockly.Variables.flyoutCategory = function (workspace) {
            let variableList = Blockly.Variables.allVariables(workspace);
            variableList.sort(goog.string.caseInsensitiveCompare);
            // In addition to the user's variables, we also want to display the default
            // variable name at the top.  We also don't want this duplicated if the
            // user has created a variable of the same name.
            goog.array.remove(variableList, varname);
            variableList.unshift(varname);

            let xmlList: HTMLElement[] = [];
            // variables getters first
            for (let i = 0; i < variableList.length; i++) {
                // <block type="variables_get" gap="24">
                //   <field name="VAR">item</field>
                // </block>
                let block = goog.dom.createDom('block');
                block.setAttribute('type', 'variables_get');
                block.setAttribute('gap', '8');
                let field = goog.dom.createDom('field', null, variableList[i]);
                field.setAttribute('name', 'VAR');
                block.appendChild(field);
                xmlList.push(block);
            }
            xmlList[xmlList.length - 1].setAttribute('gap', '24');

            for (let i = 0; i < Math.min(1, variableList.length); i++) {
                {
                    // <block type="variables_set" gap="8">
                    //   <field name="VAR">item</field>
                    // </block>
                    let block = goog.dom.createDom('block');
                    block.setAttribute('type', 'variables_set');
                    block.setAttribute('gap', '8');
                    {
                        let field = goog.dom.createDom('field', null, variableList[i]);
                        field.setAttribute('name', 'VAR');
                        block.appendChild(field);
                    }
                    {
                        let value = goog.dom.createDom('value');
                        value.setAttribute('name', 'VALUE');
                        let shadow = goog.dom.createDom('shadow');
                        shadow.setAttribute("type", "math_number");
                        value.appendChild(shadow);
                        let field = goog.dom.createDom('field');
                        field.setAttribute('name', 'NUM');
                        field.appendChild(document.createTextNode("0"));
                        shadow.appendChild(field);
                        block.appendChild(value);
                    }

                    xmlList.push(block);
                }
                {
                    // <block type="variables_get" gap="24">
                    //   <field name="VAR">item</field>
                    // </block>
                    let block = goog.dom.createDom('block');
                    block.setAttribute('type', 'variables_change');
                    block.setAttribute('gap', '24');
                    let value = goog.dom.createDom('value');
                    value.setAttribute('name', 'VALUE');
                    let shadow = goog.dom.createDom('shadow');
                    shadow.setAttribute("type", "math_number");
                    value.appendChild(shadow);
                    let field = goog.dom.createDom('field');
                    field.setAttribute('name', 'NUM');
                    field.appendChild(document.createTextNode("1"));
                    shadow.appendChild(field);
                    block.appendChild(value);

                    xmlList.push(block);
                }
            }
            return xmlList;
        };

        // builtin variables_get
        let msg: any = Blockly.Msg;
        msg.VARIABLES_GET_CREATE_SET = lf("Create 'set %1'");
        installHelpResources(
            'variables_get',
            lf("get the value of a variable"),
            lf("Returns the value of this variable."),
            '/blocks/variables'
        );

        // builtin variables_set
        msg.VARIABLES_SET = lf("set %1 to %2");
        msg.VARIABLES_DEFAULT_NAME = varname;
        //XXX Do not translate the default variable name.
        //XXX Variable names with Unicode character are harmful at this point.
        msg.VARIABLES_SET_CREATE_GET = lf("Create 'get %1'");
        installHelpResources(
            'variables_set',
            lf("assign the value of a variable"),
            lf("Sets this variable to be equal to the input."),
            '/blocks/variables/assign'
        );

        // pxt variables_change
        Blockly.Blocks['variables_change'] = {
            init: function () {
                this.jsonInit({
                    "message0": lf("change %1 by %2"),
                    "args0": [
                        {
                            "type": "field_variable",
                            "name": "VAR",
                            "variable": varname
                        },
                        {
                            "type": "input_value",
                            "name": "VALUE",
                            "check": "Number"
                        }
                    ],
                    "inputsInline": true,
                    "previousStatement": null,
                    "nextStatement": null,
                    "colour": blockColors['variables']
                });

                setHelpResources(this,
                    'variables_change',
                    lf("update the value of a number variable"),
                    lf("Changes the value of the variable by this amount"),
                    '/blocks/variables/change-var'
                );
            }
        };
    }

    function initLogic() {
        let msg: any = Blockly.Msg;

        // builtin controls_if
        msg.CONTROLS_IF_MSG_IF = lf("{id:logic}if");
        msg.CONTROLS_IF_MSG_THEN = lf("{id:logic}then");
        msg.CONTROLS_IF_MSG_ELSE = lf("{id:logic}else");
        msg.CONTROLS_IF_MSG_ELSEIF = lf("{id:logic}else if");
        msg.CONTROLS_IF_TOOLTIP_1 = lf("If a value is true, then do some statements.");
        msg.CONTROLS_IF_TOOLTIP_2 = lf("If a value is true, then do the first block of statements. Otherwise, do the second block of statements.");
        msg.CONTROLS_IF_TOOLTIP_3 = lf("If the first value is true, then do the first block of statements. Otherwise, if the second value is true, do the second block of statements.");
        msg.CONTROLS_IF_TOOLTIP_4 = lf("If the first value is true, then do the first block of statements. Otherwise, if the second value is true, do the second block of statements. If none of the values are true, do the last block of statements.");
        installHelpResources(
            'controls_if',
            lf("a conditional statement"),
            undefined,
            "blocks/logic/if"
        );

        // builtin logic_compare
        msg.LOGIC_COMPARE_TOOLTIP_EQ = lf("Return true if both inputs equal each other.");
        msg.LOGIC_COMPARE_TOOLTIP_NEQ = lf("Return true if both inputs are not equal to each other.");
        msg.LOGIC_COMPARE_TOOLTIP_LT = lf("Return true if the first input is smaller than the second input.");
        msg.LOGIC_COMPARE_TOOLTIP_LTE = lf("Return true if the first input is smaller than or equal to the second input.");
        msg.LOGIC_COMPARE_TOOLTIP_GT = lf("Return true if the first input is greater than the second input.");
        msg.LOGIC_COMPARE_TOOLTIP_GTE = lf("Return true if the first input is greater than or equal to the second input.");
        installHelpResources(
            'logic_compare',
            lf("comparing two numbers"),
            undefined,
            '/blocks/logic/boolean'
        );

        // builtin logic_operation
        msg.LOGIC_OPERATION_AND = lf("{id:op}and");
        msg.LOGIC_OPERATION_OR = lf("{id:op}or");
        msg.LOGIC_OPERATION_TOOLTIP_AND = lf("Return true if both inputs are true."),
            msg.LOGIC_OPERATION_TOOLTIP_OR = lf("Return true if at least one of the inputs is true."),
            installHelpResources(
                'logic_operation',
                lf("boolean operation"),
                undefined,
                '/blocks/logic/boolean'
            );

        // builtin logic_negate
        msg.LOGIC_NEGATE_TITLE = lf("not %1");
        installHelpResources(
            'logic_negate',
            lf("logical negation"),
            lf("Returns true if the input is false. Returns false if the input is true."),
            '/blocks/logic/boolean'
        );

        // builtin logic_boolean
        msg.LOGIC_BOOLEAN_TRUE = lf("{id:boolean}true");
        msg.LOGIC_BOOLEAN_FALSE = lf("{id:boolean}false");
        installHelpResources(
            'logic_boolean',
            lf("a `true` or `false` value"),
            lf("Returns either true or false."),
            '/blocks/logic/boolean'
        );
    }

    function initText() {
        // builtin text
        installHelpResources(
            'text',
            lf("a piece of text"),
            lf("A letter, word, or line of text."),
            "reference/types/string"
        );

        // builtin text_length
        let msg: any = Blockly.Msg;
        msg.TEXT_LENGTH_TITLE = lf("length of %1");
        installHelpResources(
            'text_length',
            lf("number of characters in the string"),
            lf("Returns the number of letters (including spaces) in the provided text."),
            "reference/types/string-functions"
        );
    }
}
