import * as Docs  from '../doc/';

/**
 * Provides a symbol to store checking if already covered.
 * @type {Symbol}
 * @ignore
 */
const s_ALREADY = Symbol('already');

/**
 * Doc generator. Provides static doc object generation for main source files inserting into the given DocDB.
 *
 * @example
 * DocGenerator.resetAndTraverse(ast, docDB, pathResolver, eventbus);
 */
export default class DocGenerator
{
   /**
    * Stores export nodes that need to be resolved in a second pass.
    * @type {ASTNode[]}
    * @private
    */
   static _exportNodesPass = [];

   /**
    * Stores an array of already processed class nodes.
    * @type {ASTNode[]}
    * @private
    */
   static _processedClassNodes = [];

   /**
    * Wires up the event binding to get DocGenerator.
    *
    * @param {PluginEvent} ev - The plugin event.
    */
   static onPluginLoad(ev)
   {
      ev.eventbus.on('tjsdoc:system:doc:generator:get', () => DocGenerator);
   }

   /**
    * Resets DocFactory and traverses code for doc object / docDB insertion.
    *
    * @param {AST}            ast - AST of source code.
    *
    * @param {DocDB}          docDB - The target DocDB.
    *
    * @param {PathResolver}   pathResolver - The path resolver of source code.
    *
    * @param {EventProxy}     eventbus - An event proxy for the plugin eventbus.
    *
    * @param {string}         handleError - Determines how to handle errors. Options are `log` and `throw` with the
    *                                       default being to throw any errors encountered.
    *
    * @param {String}         [code] - Designates that the ast is from an in memory source rather than a file.
    */
   static resetAndTraverse(ast, docDB, pathResolver, eventbus, handleError, code = void 0)
   {
      /**
       * AST of source code.
       * @type {AST}
       * @private
       */
      this._ast = ast;

      /**
       * The target DocDB.
       * @type {DocDB}
       * @private
       */
      this._docDB = docDB;

      /**
       * The path resolver of source code.
       * @type {PathResolver}
       * @private
       */
      this._pathResolver = pathResolver;

      /**
       * Stores the plugin eventbus proxy.
       * @type {EventProxy}
       * @private
       */
      this._eventbus = eventbus;

      /**
       * Determines how to handle errors. Options are `log` and `throw` with the default being to throw any errors
       * encountered.
       * @type {string}
       * @private
       */
      this._handleError = handleError;

      // Reset tracking arrays.
      this._processedClassNodes.length = 0;
      this._exportNodesPass.length = 0;

      // Gets the current global / main plugin DocDB counter doc ID then increment it.
      const docID = eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get');

      // If code is defined then treat it as an memory doc otherwise a file doc.
      const staticDoc = typeof code === 'string' ? Docs.MemoryDoc.create(docID, ast, ast, pathResolver, [],
       this._eventbus, code) : Docs.FileDoc.create(docID, ast, ast, pathResolver, [], this._eventbus);

      // Insert file or memory doc and reset.
      this._docDB.insertStaticDoc(staticDoc);

      /**
       * Store the docID for the memory / file and add it to all children doc data as `__moduleID__`.
       * @type {number}
       */
      this._moduleID = docID;

      // AST does not have a body or children nodes so only comments are potentially present.
      if (ast.program.body.length === 0 && ast.program.innerComments)
      {
         this._traverseComments(null, ast, ast.program.innerComments);
      }

      this._traverse();

      // TODO REMOVE: _traverseOld is the original AST modification version
      // this._traverseOld();

      // Reset statically stored data after traversal.
      this._ast = void 0;
      this._docDB = void 0;
      this._pathResolver = void 0;
      this._eventbus = void 0;
      this._handleError = void 0;
      this._moduleID = void 0;
      this._processedClassNodes.length = 0;
      this._exportNodesPass.length = 0;
   }

   /**
    * Create a doc object by node type.
    *
    * @param {ASTNode} node - target node.
    *
    * @param {Tag[]} tags - tags of target node.
    *
    * @returns {AbstractDoc} created Doc.
    *
    * @private
    */
   static _createDoc(node, tags)
   {
      // Decide if there is a doc type to process based on tags and node.
      const result = this._decideType(tags, node);
      const type = result.type;

      node = result.node;

      if (!type) { return null; }

      // Store all ModuleClass nodes which provides an inclusion check for class properties / members.
      if (type === 'ModuleClass') { this._processedClassNodes.push(node); }

      let Clazz;

      switch (type)
      {
         case 'ClassMember':
            Clazz = Docs.ClassMemberDoc;
            break;

         case 'ClassMethod':
            Clazz = Docs.ClassMethodDoc;
            break;

         case 'ClassProperty':
            Clazz = Docs.ClassPropertyDoc;
            break;

         case 'ModuleAssignment':
            Clazz = Docs.ModuleAssignmentDoc;
            break;

         case 'ModuleClass':
            Clazz = Docs.ModuleClassDoc;
            break;

         case 'ModuleFunction':
            Clazz = Docs.ModuleFunctionDoc;
            break;

         case 'ModuleVariable':
            Clazz = Docs.ModuleVariableDoc;
            break;

         case 'VirtualExternal':
            Clazz = Docs.VirtualExternalDoc;
            break;

         case 'VirtualTypedef':
            Clazz = Docs.VirtualTypedefDoc;
            break;

         default:
            throw new Error(`unexpected type: ${type}`);
      }

      if (!Clazz) { return null; }
      if (!node.type) { node.type = type; }

      // Create the static doc with the next global doc ID and current file / module ID.
      return Clazz.create(this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get'), this._moduleID,
       this._ast, node, this._pathResolver, tags, this._eventbus);
   }

   /**
    * Decide doc object type from arrow function expression node.
    *
    * @param {ASTNode} node - target node that is arrow function expression node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   static _decideModuleArrowFunctionExpressionType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      return { type: 'ModuleFunction', node };
   }

   /**
    * Decide doc object type from `AssignmentExpression` node.
    *
    * @example
    * export default functionName = function() {}
    * export default functionName = () => {}
    * export default ClassName = class {}
    *
    * @param {ASTNode} node - target node that is assignment node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   static _decideModuleAssignmentType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      let innerType;

      switch (node.right.type)
      {
         case 'ArrowFunctionExpression':
         case 'FunctionExpression':
            innerType = 'ModuleFunction';
            break;

         case 'ClassExpression':
            innerType = 'ModuleClass';
            break;

         default:
            return { type: 'ModuleAssignment', node };
      }

      const innerNode = node.right;

      Reflect.defineProperty(innerNode, 'parent', { value: node });

      innerNode[s_ALREADY] = true;

      return { type: innerType, node: innerNode };
   }

   /**
    * Decide doc object type from class declaration node.
    *
    * @param {ASTNode} node - target node that is class declaration node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   static _decideClassDeclarationType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      return { type: 'ModuleClass', node };
   }

   /**
    * Decide doc object type from class property node.
    *
    * @param {ASTNode} node - target node that is classs property node.
    *
    * @returns {{type: ?string, node: ?ASTNode}} decided type.
    * @private
    */
   static _decideClassPropertyType(node)
   {
      const classNode = this._findUp(node, ['ClassDeclaration', 'ClassExpression']);

      if (this._processedClassNodes.includes(classNode))
      {
         return { type: 'ClassProperty', node };
      }
      else
      {
         const sanitizedNode = this._eventbus.triggerSync('tjsdoc:system:ast:node:sanitize:children', node);

         this._eventbus.trigger('log:warn', 'This class property is not in class:', JSON.stringify(sanitizedNode));

         return { type: null, node: null };
      }
   }

   /**
    * Decide doc object type from expression statement node. In particular class membership or `this.x` statements
    * are parsed.
    *
    * @example
    * class Test
    * {
    *    constructor()
    *    {
    *       this.pickedUp = true; // Parses class membership.
    *    }
    * }
    *
    * @param {ASTNode} node - target node that is expression statement node.
    *
    * @returns {{type: ?string, node: ?ASTNode}} decided type.
    * @private
    */
   static _decideExpressionStatementType(node)
   {
      if (!node.expression.right) { return { type: null, node: null }; }

      Reflect.defineProperty(node.expression, 'parent', { value: node });

      if (node.expression.left.type === 'MemberExpression' && node.expression.left.object.type === 'ThisExpression')
      {
         const classNode = this._findUp(node.expression, ['ClassExpression', 'ClassDeclaration']);

         // No class node was found in an upward search. In certain situations this could be a function meant to
         // be applied with a particular context for `this`. However, it's not considered a member doc node.
         if (classNode === null) { return { type: null, node: null }; }

         node.expression[s_ALREADY] = true;

         return { type: 'ClassMember', node: node.expression };
      }
      else
      {
         return { type: null, node: null };
      }
   }

   /**
    * Decide doc object type from function declaration node.
    *
    * @param {ASTNode} node - target node that is function declaration node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   static _decideModuleFunctionDeclarationType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      return { type: 'ModuleFunction', node };
   }

   /**
    * Decide doc object type from function expression node.
    *
    * @param {ASTNode} node - target node that is function expression node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   static _decideModuleFunctionExpressionType(node)
   {
      if (!node.async) { return { type: null, node: null }; }
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      return { type: 'ModuleFunction', node };
   }

   /**
    * Decide doc object  type from method definition node.
    *
    * @param {ASTNode} node - target node that is method definition node.
    *
    * @returns {{type: ?string, node: ?ASTNode}} decided type.
    * @private
    */
   static _decideClassMethodDefinitionType(node)
   {
      const classNode = this._findUp(node, ['ClassDeclaration', 'ClassExpression']);

      if (this._processedClassNodes.includes(classNode))
      {
         return { type: 'ClassMethod', node };
      }
      else
      {
         const sanitizedNode = this._eventbus.triggerSync('tjsdoc:system:ast:node:sanitize:children', node);

         this._eventbus.trigger('log:warn', 'This method is not in class:', JSON.stringify(sanitizedNode));

         return { type: null, node: null };
      }
   }

   /**
    * Decide doc object type by using tags and node.
    *
    * @param {Tag[]} tags - tags of node.
    *
    * @param {ASTNode} node - target node.
    *
    * @returns {{type: ?string, node: ?ASTNode}} decided type.
    * @private
    */
   static _decideType(tags, node)
   {
      let type = null;

      for (const tag of tags)
      {
         const tagName = tag.tagName;

         switch (tagName)
         {
            case '@typedef':
               type = 'VirtualTypedef';
               break;

            case '@external':
               type = 'VirtualExternal';
               break;
         }
      }

      if (type) { return { type, node }; }

      if (!node) { return { type, node }; }

      switch (node.type)
      {
         case 'ArrowFunctionExpression':
            return this._decideModuleArrowFunctionExpressionType(node);

         case 'AssignmentExpression':
            return this._decideModuleAssignmentType(node);

         case 'ClassDeclaration':
            return this._decideClassDeclarationType(node);

         case 'ClassMethod':
            return this._decideClassMethodDefinitionType(node);

         case 'ClassProperty':
            return this._decideClassPropertyType(node);

         case 'ExpressionStatement':
            return this._decideExpressionStatementType(node);

         case 'FunctionDeclaration':
            return this._decideModuleFunctionDeclarationType(node);

         case 'FunctionExpression':
            return this._decideModuleFunctionExpressionType(node);

         case 'VariableDeclaration':
            return this._decideModuleVariableType(node);
      }

      return { type: null, node: null };
   }

   /**
    * Decide doc object type from variable node.
    *
    * @param {ASTNode} node - target node that is variable node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   static _decideModuleVariableType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      if (!node.declarations[0].init) { return { type: null, node: null }; }

      let innerType = null;

      switch (node.declarations[0].init.type)
      {
         case 'ArrowFunctionExpression':
         case 'FunctionExpression':
            innerType = 'ModuleFunction';
            break;

         case 'ClassExpression':
            innerType = 'ModuleClass';
            break;

         default:
            return { type: 'ModuleVariable', node };
      }

      const innerNode = node.declarations[0].init;

      Reflect.defineProperty(innerNode, 'parent', { value: node });

      innerNode[s_ALREADY] = true;

      return { type: innerType, node: innerNode };
   }

   /**
    * Returns the current AST set.
    * @returns {AST}
    */
   static get ast()
   {
      return this._ast;
   }

   /**
    * Returns the current file path set.
    * @returns {string|undefined}
    */
   static get filePath()
   {
      return this._pathResolver ? this._pathResolver.filePath : void 0;
   }

   /**
    * Find node while traversing up the parent tree.
    *
    * @param {ASTNode} node - start node.
    *
    * @param {string[]} types - ASTNode types.
    *
    * @returns {ASTNode|null} found first node.
    * @private
    */
   static _findUp(node, types)
   {
      let parent = node.parent;

      while (parent)
      {
         if (types.includes(parent.type)) { return parent; }

         parent = parent.parent;
      }

      return null;
   }

   /**
    * Determines if an export node requires a second pass.
    *
    * @param {ASTNode}  node - Node to examine.
    *
    * @returns {boolean} True if the node is stored for a second pass.
    * @private
    */
   static _isExportSecondPass(node)
   {
      // Export default declarations that reference an identifier or create a new expression need to be processed
      // in a second pass to ensure that the target expression is resolved.
      if (node.type === 'ExportDefaultDeclaration')
      {
         if (node.declaration.type === 'Identifier' || node.declaration.type === 'NewExpression')
         {
            this._exportNodesPass.push(node);
            return true;
         }
      }
      else if (node.type === 'ExportNamedDeclaration')
      {
         if (node.specifiers.length > 0)
         {
            this._exportNodesPass.push(node);
            return true;
         }

         if ((node.declaration && node.declaration.type === 'VariableDeclaration'))
         {
            for (const declaration of node.declaration.declarations)
            {
               if (!declaration.init || declaration.init.type !== 'NewExpression') { continue; }

               const classNode = this._eventbus.triggerSync('tjsdoc:system:ast:class:declaration:find', this._ast,
                declaration.init.callee.name);

               if (classNode)
               {
                  this._exportNodesPass.push(node);
                  return true;
               }
            }
         }
      }

      return false;
   }

   /**
    * Determine if node is the last in parent.
    *
    * @param {ASTNode} node - target node.
    *
    * @param {ASTNode} parentNode - target parent node.
    *
    * @returns {boolean} if true, the node is last in parent.
    * @private
    */
   static _isLastNodeInParent(node, parentNode)
   {
      if (parentNode && parentNode.body)
      {
         const lastNode = parentNode.body[parentNode.body.length - 1];
         return node === lastNode;
      }

      return false;
   }

   /**
    * Determine if the node is at the top in body.
    *
    * @param {ASTNode} node - target node.
    *
    * @param {ASTNode[]} body - target body node.
    *
    * @returns {boolean} if true, the node is top in body.
    * @private
    */
   static _isTopDepthInBody(node, body)
   {
      if (!body) { return false; }
      if (!Array.isArray(body)) { return false; }

      const parentNode = node.parent;

      switch (parentNode.type)
      {
         case 'ExportDefaultDeclaration':
         case 'ExportNamedDeclaration':
            node = parentNode;
            break;
      }

      for (const _node of body)
      {
         if (node === _node) { return true; }
      }

      return false;
   }

   /**
    * Performs second pass processing of default export nodes.
    *
    * case1: separated export
    *
    * ```javascript
    * class Foo {}
    * export default Foo;
    * ```
    *
    * case2: export instance(directly).
    *
    * ```javascript
    * class Foo {}
    * export default new Foo();
    * ```
    *
    * case3: export instance(indirectly).
    *
    * ```javascript
    * class Foo {}
    * let foo = new Foo();
    * export default foo;
    * ```

    * @param {ASTNode}  exportNode - target default export to process.
    *
    * @private
    * @todo support function export.
    */
   static _processDefaultExport(exportNode)
   {
      const filePath = this.filePath;
      let targetClassName = null;
      let targetVariableName = null;
      let pseudoClassExport;

      switch (exportNode.declaration.type)
      {
         case 'NewExpression':
            if (exportNode.declaration.callee.type === 'Identifier')
            {
               targetClassName = exportNode.declaration.callee.name;
            }
            else if (exportNode.declaration.callee.type === 'MemberExpression')
            {
               targetClassName = exportNode.declaration.callee.property.name;
            }
            else
            {
               targetClassName = '';
            }

            targetVariableName = targetClassName.replace(/^./, (c) => c.toLowerCase());
            pseudoClassExport = true;

            break;

         case 'Identifier':
         {
            const varNode = this._eventbus.triggerSync('tjsdoc:system:ast:variable:declaration:new:expression:find',
             this._ast, exportNode.declaration.name);

            if (varNode)
            {
               targetClassName = varNode.declarations[0].init.callee.name;
               targetVariableName = exportNode.declaration.name;
               pseudoClassExport = true;

               this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', varNode);
            }
            else
            {
               targetClassName = exportNode.declaration.name;
               pseudoClassExport = false;
            }
            break;
         }

         default:
            this._eventbus.trigger('log:warn', `Unknown export declaration type. type = "${
             exportNode.declaration.type}"`);
            break;
      }

      const classDoc = this._docDB.find({ name: targetClassName, filePath });

      if (Array.isArray(classDoc) && classDoc.length > 0)
      {
         classDoc[0].importStyle = pseudoClassExport ? null : targetClassName;
         classDoc[0].export = true;

         if (targetVariableName) { this._updateOrCreateVarDoc(targetVariableName, targetClassName, exportNode); }
      }

      const funcDoc = this._docDB.find({ name: exportNode.declaration.name, filePath });

      if (Array.isArray(funcDoc) && funcDoc.length > 0)
      {
         funcDoc[0].importStyle = exportNode.declaration.name;
         funcDoc[0].export = true;
         funcDoc[0].ignore = false;
      }

      const varDoc = this._docDB.find({ name: exportNode.declaration.name, filePath });

      if (Array.isArray(varDoc) && varDoc.length > 0)
      {
         varDoc[0].importStyle = exportNode.declaration.name;
         varDoc[0].export = true;
         varDoc[0].ignore = false;
      }
   }

   /**
    * Dispatches second pass processing for export nodes that require further processing.
    *
    * @private
    */
   static _processExports()
   {
      for (const exportNode of this._exportNodesPass)
      {
         let exportNodeHasIgnoreTag = false;

         // Parse any leading comments from the given export node to find `@ignore`.
         if (Array.isArray(exportNode.leadingComments) && exportNode.leadingComments.length > 0)
         {
            const exportNodeTags = this._eventbus.triggerSync('tjsdoc:system:parser:comment:parse',
             exportNode.leadingComments[exportNode.leadingComments.length - 1]);

            for (const tag of exportNodeTags)
            {
               if (tag.tagName === '@ignore') { exportNodeHasIgnoreTag = true; break; }
            }
         }

         // If the export has `@ignore` then no doc object is parsed or updated.
         if (exportNodeHasIgnoreTag) { continue; }

         switch (exportNode.type)
         {
            case 'ExportDefaultDeclaration':
               this._processDefaultExport(exportNode);
               break;

            case 'ExportNamedDeclaration':
               this._processNamedExport(exportNode);
               break;
         }
      }
   }

   /**
    * Performs second pass processing of named export nodes.
    *
    * case1: separated export
    *
    * ```javascript
    * class Foo {}
    * export {Foo};
    * ```
    *
    * case2: export instance(indirectly).
    *
    * ```javascript
    * class Foo {}
    * let foo = new Foo();
    * export {foo};
    * ```
    *
    * @param {ASTNode}  exportNode - target default export to process.
    *
    * @private
    * @todo support function export.
    */
   static _processNamedExport(exportNode)
   {
      const filePath = this.filePath;

      if (exportNode.declaration && exportNode.declaration.type === 'VariableDeclaration')
      {
         for (const declaration of exportNode.declaration.declarations)
         {
            if (!declaration.init || declaration.init.type !== 'NewExpression') { continue; }

            const targetClassName = declaration.init.callee.name;
            const targetVariableName = declaration.id.name;

            const classDoc = this._docDB.find({ name: targetClassName, filePath });

            if (Array.isArray(classDoc) && classDoc.length > 0)
            {
               classDoc[0].export = true;
               classDoc[0].ignore = false;
               classDoc[0].importStyle = null;
            }

            if (targetVariableName && targetClassName)
            {
               this._updateOrCreateVarDoc(targetVariableName, targetClassName, exportNode);
            }
         }

         // Early out except for export nodes that also have specifiers.
         if (exportNode.specifiers.length === 0) { return; }
      }

      for (const specifier of exportNode.specifiers)
      {
         if (specifier.type !== 'ExportSpecifier') { continue; }

         let targetClassName = null;
         let pseudoClassExport;

         const varNode = this._eventbus.triggerSync('tjsdoc:system:ast:variable:declaration:new:expression:find',
          this._ast, specifier.exported.name);

         if (varNode)
         {
            const varDoc = this._docDB.find({ name: specifier.exported.name, filePath });

            if (Array.isArray(varDoc) && varDoc.length > 0)
            {
               varDoc[0].importStyle = `{${specifier.exported.name}}`;
               varDoc[0].export = true;
               varDoc[0].ignore = false;
            }

            targetClassName = varNode.declarations[0].init.callee.name;
            pseudoClassExport = true;
         }
         else
         {
            targetClassName = specifier.exported.name;
            pseudoClassExport = false;
         }

         const classDoc = this._docDB.find({ name: specifier.exported.name, filePath });

         if (Array.isArray(classDoc) && classDoc.length > 0)
         {
            classDoc[0].importStyle = pseudoClassExport ? null : `{${targetClassName}}`;
            classDoc[0].export = true;
            classDoc[0].ignore = false;
         }

         const funcDoc = this._docDB.find({ name: specifier.exported.name, filePath });

         if (Array.isArray(funcDoc) && funcDoc.length > 0)
         {
            funcDoc[0].importStyle = `{${specifier.exported.name}}`;
            funcDoc[0].export = true;
            funcDoc[0].ignore = false;
         }

         const varDoc = this._docDB.find({ name: specifier.exported.name, filePath });

         if (Array.isArray(varDoc) && varDoc.length > 0)
         {
            varDoc[0].importStyle = `{${specifier.exported.name}}`;
            varDoc[0].export = true;
            varDoc[0].ignore = false;
         }
      }
   }

   /**
    * Push a node for generator processing.
    *
    * @param {ASTNode} node - target node.
    *
    * @param {ASTNode} parentNode - parent node of target node.
    */
   static _push(node, parentNode)
   {
      if (node === this._ast) { return; }

      if (node[s_ALREADY]) { return; }

      const isLastNodeInParent = this._isLastNodeInParent(node, parentNode);

      node[s_ALREADY] = true;

      Reflect.defineProperty(node, 'parent', { value: parentNode });

      switch (node.type)
      {
         // Unwrap export declaration
         case 'ExportDefaultDeclaration':
         case 'ExportNamedDeclaration':
            this._unwrapExportNodeAndTraverse(node, isLastNodeInParent);
            break;

         default:
            this._traverseNode(node, parentNode, isLastNodeInParent);
            break;
      }
   }

   /**
    * Traverse doc comments in given file.
    *
    * @private
    */
   static _traverse()
   {
      const filePath = this.filePath;

      this._eventbus.trigger('typhonjs:ast:walker:traverse', this._ast,
      {
         enterNode: (node, parent) =>
         {
            try
            {
               // Some export nodes are resolved in a second pass. If this is the case stop further traversal of
               // children nodes.
               if (this._isExportSecondPass(node)) { return null; }

               this._push(node, parent);
            }
            catch (fatalError)
            {
               switch (this._handleError)
               {
                  case 'log':
                     this._eventbus.trigger('tjsdoc:system:invalid:code:add', { filePath, node, fatalError });
                     break;

                  case 'throw':
                     throw fatalError;
               }
            }
         }
      });

      this._processExports();
   }

   /**
    * Traverses comments of node and creates any applicable doc objects.
    *
    * @param {?ASTNode} node - target node.
    *
    * @param {ASTNode|AST} parentNode - parent of target node.
    *
    * @param {ASTNode[]} comments - comment nodes.
    *
    * @private
    */
   static _traverseComments(node, parentNode, comments)
   {
      if (!node)
      {
         const virtualNode = {};

         Reflect.defineProperty(virtualNode, 'parent', { value: parentNode });

         node = virtualNode;
      }

      if (comments && comments.length)
      {
         const temp = [];

         for (const comment of comments)
         {
            if (this._eventbus.triggerSync('tjsdoc:system:parser:comment:node:value:get', comment) !== void 0)
            {
               temp.push(comment);
            }
         }

         comments = temp;
      }
      else
      {
         comments = [];
      }

      if (comments.length === 0)
      {
         comments = [{ type: 'CommentBlock', value: '* @_undocument' }];
      }

      const lastComment = comments[comments.length - 1];

      for (const comment of comments)
      {
         const tags = this._eventbus.triggerSync('tjsdoc:system:parser:comment:parse', comment);

         let staticDoc;

         if (comment === lastComment)
         {
            staticDoc = this._createDoc(node, tags);
         }
         else
         {
            const virtualNode = {};

            Reflect.defineProperty(virtualNode, 'parent', { value: parentNode });

            staticDoc = this._createDoc(virtualNode, tags);
         }

         // Insert doc and reset.
         if (staticDoc) { this._docDB.insertStaticDoc(staticDoc); }
      }
   }

   /**
    * Provides standard node traversal generating doc data from traversing a nodes comments.
    *
    * @param {ASTNode}  node - target node to traverse.
    *
    * @param {ASTNode}  parentNode - parent node of the target.
    *
    * @param {boolean}  isLastNodeInParent - indicates the node is the last in its parent node.
    *
    * @private
    */
   static _traverseNode(node, parentNode, isLastNodeInParent)
   {
      // If node has decorators leading comments are attached to decorators.
      if (node.decorators && node.decorators[0].leadingComments)
      {
         if (!node.leadingComments || !node.leadingComments.length)
         {
            node.leadingComments = node.decorators[0].leadingComments;
         }
      }

      this._traverseComments(node, parentNode, node.leadingComments);

      // For trailing comments traverse with only last node preventing duplication of trailing comments.
      if (node.trailingComments && isLastNodeInParent)
      {
         this._traverseComments(null, parentNode, node.trailingComments);
      }
   }

   /**
    * Unwraps exported node.
    *
    * @param {ASTNode} node - target node that is export declaration node.
    *
    * @param {boolean} isLastNodeInParent - indicates the node is the last in its parent node.
    *
    * @private
    */
   static _unwrapExportNodeAndTraverse(node, isLastNodeInParent)
   {
      // e.g. `export A from './A.js'` has no declaration
      if (!node.declaration) { return; }

      const exportedASTNode = node.declaration;

      const leadingComments = [];
      const trailingComments = [];

      if (exportedASTNode.leadingComments) { leadingComments.push(...exportedASTNode.leadingComments); }
      if (node.leadingComments) { leadingComments.push(...node.leadingComments); }

      if (exportedASTNode.trailingComments) { trailingComments.push(...exportedASTNode.trailingComments); }
      if (node.trailingComments) { trailingComments.push(...node.trailingComments); }

      exportedASTNode[s_ALREADY] = true;

      Reflect.defineProperty(exportedASTNode, 'parent', { value: node });

      // Now traverse the exported node comments with the synthesized leading and trailing comments

      // If node has decorators leading comments are attached to decorators.
      if (exportedASTNode.decorators && exportedASTNode.decorators[0].leadingComments)
      {
         leadingComments.push(...exportedASTNode.decorators[0].leadingComments);
      }

      this._traverseComments(exportedASTNode, node, leadingComments);

      // For trailing comments traverse with only last node preventing duplication of trailing comments.
      if (trailingComments.length > 0 && isLastNodeInParent)
      {
         this._traverseComments(null, node, trailingComments);
      }
   }

   /**
    * If there is an existing variable doc then modify the existing variable doc with the export semantics, but only if
    * `@ignore` is not included in the comments for `exportNode`. Otherwise synthesize a virtual variable doc from
    * the given variable name from `exportNode`.
    *
    * @param {string}   targetVariableName - Target variable doc name to update or synthesize.
    *
    * @param {string}   targetClassName - Target class name that the variable reference targets.
    *
    * @param {ASTNode}  exportNode - The source export node.
    *
    * @private
    */
   static _updateOrCreateVarDoc(targetVariableName, targetClassName, exportNode)
   {
      const filePath = this.filePath;
      const isDefaultExport = exportNode.type === 'ExportDefaultDeclaration';

      // First synthesize the virtual variable doc from `exportNode`.
      const virtualVarNode = this._eventbus.triggerSync(
       'tjsdoc:system:ast:variable:declaration:new:expression:create', targetVariableName, targetClassName,
        exportNode);

      Reflect.defineProperty(virtualVarNode, 'parent', { value: this._ast.program.body });

      let tags = [];

      if (Array.isArray(virtualVarNode.leadingComments) && virtualVarNode.leadingComments.length > 0)
      {
         tags = this._eventbus.triggerSync('tjsdoc:system:parser:comment:parse',
          virtualVarNode.leadingComments[virtualVarNode.leadingComments.length - 1]);
      }

      const virtualVarDoc = Docs.ModuleVariableDoc.create(
       this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get'), this._moduleID,
        this._ast, virtualVarNode, this._pathResolver, tags, this._eventbus);

      // Search for an existing variable doc with the same name.
      const existingVarDoc = this._docDB.find({ kind: 'variable', name: targetVariableName, filePath });

      // If there is an existing variable doc update it with the export data.
      if (Array.isArray(existingVarDoc) && existingVarDoc.length > 0)
      {
         existingVarDoc[0].description += `\n${virtualVarDoc._value.description}`;
         existingVarDoc[0].export = true;
         existingVarDoc[0].importStyle = isDefaultExport ? targetVariableName : `{${targetVariableName}}`;
         existingVarDoc[0].type = { types: [`${filePath}~${targetClassName}`] };
         existingVarDoc[0].ignore = false;
      }
      else
      {
         virtualVarDoc._value.export = true;
         virtualVarDoc._value.importStyle = isDefaultExport ? targetVariableName : `{${targetVariableName}}`;
         virtualVarDoc._value.type = { types: [`${filePath}~${targetClassName}`] };

         // No existing variable doc has been found, so insert the exported virtual variable doc.
         this._docDB.insertStaticDoc(virtualVarDoc);
      }
   }

// TODO REMOVE: old original AST modification traversal -------------------------------------------------------------

   /**
    * Deep copy object.
    *
    * @param {Object} obj - target object.
    *
    * @return {Object} copied object.
    * @private
    */
   static _copy(obj)
   {
      return JSON.parse(JSON.stringify(obj));
   }

   /**
    * Inspects ExportDefaultDeclaration.
    *
    * case1: separated export
    *
    * ```javascript
    * class Foo {}
    * export default Foo;
    * ```
    *
    * case2: export instance(directly).
    *
    * ```javascript
    * class Foo {}
    * export default new Foo();
    * ```
    *
    * case3: export instance(indirectly).
    *
    * ```javascript
    * class Foo {}
    * let foo = new Foo();
    * export default foo;
    * ```
    *
    * @private
    * @todo support function export.
    */
   static _inspectExportDefaultDeclaration()
   {
      const pseudoExportNodes = [];

      for (const exportNode of this._ast.program.body)
      {
         if (exportNode.type !== 'ExportDefaultDeclaration') { continue; }

         let targetClassName = null;
         let targetVariableName = null;
         let pseudoClassExport;

         switch (exportNode.declaration.type)
         {
            case 'NewExpression':
               if (exportNode.declaration.callee.type === 'Identifier')
               {
                  targetClassName = exportNode.declaration.callee.name;
               }
               else if (exportNode.declaration.callee.type === 'MemberExpression')
               {
                  targetClassName = exportNode.declaration.callee.property.name;
               }
               else
               {
                  targetClassName = '';
               }

               targetVariableName = targetClassName.replace(/^./, (c) => c.toLowerCase());
               pseudoClassExport = true;

               break;

            case 'Identifier':
            {
               const varNode = this._eventbus.triggerSync('tjsdoc:system:ast:variable:declaration:new:expression:find',
                this._ast, exportNode.declaration.name);

               if (varNode)
               {
                  targetClassName = varNode.declarations[0].init.callee.name;
                  targetVariableName = exportNode.declaration.name;
                  pseudoClassExport = true;

                  this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', varNode);
               }
               else
               {
                  targetClassName = exportNode.declaration.name;
                  pseudoClassExport = false;
               }
               break;
            }

            // Do nothing
            case 'ArrowFunctionExpression':
            case 'AssignmentExpression':
            case 'ClassDeclaration':
            case 'FunctionExpression':
            case 'FunctionDeclaration':
               break;

            default:
               this._eventbus.trigger('log:warn', `Unknown export declaration type. type = "${
                exportNode.declaration.type}"`);
               break;
         }

         const classNode = this._eventbus.triggerSync('tjsdoc:system:ast:class:declaration:find', this._ast,
          targetClassName);

         if (classNode)
         {
            const pseudoExportNode1 = this._copy(exportNode);

            pseudoExportNode1.declaration = this._copy(classNode);
            pseudoExportNode1.leadingComments = null;
            pseudoExportNode1.declaration.__PseudoExport__ = pseudoClassExport;

            pseudoExportNodes.push(pseudoExportNode1);

            if (targetVariableName)
            {
               const pseudoExportNode2 = this._copy(exportNode);

               pseudoExportNode2.declaration = this._eventbus.triggerSync(
                'tjsdoc:system:ast:variable:declaration:new:expression:create', targetVariableName, targetClassName,
                 exportNode);

               pseudoExportNodes.push(pseudoExportNode2);
            }

            this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', classNode);
            this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', exportNode);
         }

         const functionNode = this._eventbus.triggerSync('tjsdoc:system:ast:function:declaration:find', this._ast,
          exportNode.declaration.name);

         if (functionNode)
         {
            const pseudoExportNode = this._copy(exportNode);

            pseudoExportNode.declaration = this._copy(functionNode);

            this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', exportNode);
            this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', functionNode);

            pseudoExportNodes.push(pseudoExportNode);
         }

         const variableNode = this._eventbus.triggerSync('tjsdoc:system:ast:variable:declaration:find', this._ast,
          exportNode.declaration.name);

         if (variableNode)
         {
            const pseudoExportNode = this._copy(exportNode);

            pseudoExportNode.declaration = this._copy(variableNode);

            this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', exportNode);
            this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', variableNode);

            pseudoExportNodes.push(pseudoExportNode);
         }
      }

      this._ast.program.body.push(...pseudoExportNodes);
   }

   /**
    * Inspects ExportNamedDeclaration.
    *
    * case1: separated export
    *
    * ```javascript
    * class Foo {}
    * export {Foo};
    * ```
    *
    * case2: export instance(indirectly).
    *
    * ```javascript
    * class Foo {}
    * let foo = new Foo();
    * export {foo};
    * ```
    *
    * @private
    * @todo support function export.
    */
   static _inspectExportNamedDeclaration()
   {
      const pseudoExportNodes = [];

      for (const exportNode of this._ast.program.body)
      {
         if (exportNode.type !== 'ExportNamedDeclaration') { continue; }

         if (exportNode.declaration && exportNode.declaration.type === 'VariableDeclaration')
         {
            for (const declaration of exportNode.declaration.declarations)
            {
               if (!declaration.init || declaration.init.type !== 'NewExpression') { continue; }

               const classNode = this._eventbus.triggerSync('tjsdoc:system:ast:class:declaration:find', this._ast,
                declaration.init.callee.name);

               if (classNode)
               {
                  const pseudoExportNode = this._copy(exportNode);

                  pseudoExportNode.declaration = this._copy(classNode);
                  pseudoExportNode.leadingComments = null;
                  pseudoExportNodes.push(pseudoExportNode);
                  pseudoExportNode.declaration.__PseudoExport__ = true;

                  this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', classNode);
               }
            }
            continue;
         }

         for (const specifier of exportNode.specifiers)
         {
            if (specifier.type !== 'ExportSpecifier') { continue; }

            let targetClassName = null;
            let pseudoClassExport;

            const varNode = this._eventbus.triggerSync('tjsdoc:system:ast:variable:declaration:new:expression:find',
             this._ast, specifier.exported.name);

            if (varNode)
            {
               targetClassName = varNode.declarations[0].init.callee.name;
               pseudoClassExport = true;

               const pseudoExportNode = this._copy(exportNode);

               pseudoExportNode.declaration = this._copy(varNode);
               pseudoExportNode.specifiers = null;
               pseudoExportNodes.push(pseudoExportNode);

               this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', varNode);
            }
            else
            {
               targetClassName = specifier.exported.name;
               pseudoClassExport = false;
            }

            const classNode = this._eventbus.triggerSync('tjsdoc:system:ast:class:declaration:find', this._ast,
             targetClassName);

            if (classNode)
            {
               const pseudoExportNode = this._copy(exportNode);

               pseudoExportNode.declaration = this._copy(classNode);
               pseudoExportNode.leadingComments = null;
               pseudoExportNode.specifiers = null;
               pseudoExportNode.declaration.__PseudoExport__ = pseudoClassExport;

               pseudoExportNodes.push(pseudoExportNode);

               this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', classNode);
            }

            const functionNode = this._eventbus.triggerSync('tjsdoc:system:ast:function:declaration:find', this._ast,
             specifier.exported.name);

            if (functionNode)
            {
               const pseudoExportNode = this._copy(exportNode);

               pseudoExportNode.declaration = this._copy(functionNode);
               pseudoExportNode.leadingComments = null;
               pseudoExportNode.specifiers = null;

               this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', functionNode);

               pseudoExportNodes.push(pseudoExportNode);
            }

            const variableNode = this._eventbus.triggerSync('tjsdoc:system:ast:variable:declaration:find', this._ast,
             specifier.exported.name);

            if (variableNode)
            {
               const pseudoExportNode = this._copy(exportNode);

               pseudoExportNode.declaration = this._copy(variableNode);
               pseudoExportNode.leadingComments = null;
               pseudoExportNode.specifiers = null;

               this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', variableNode);

               pseudoExportNodes.push(pseudoExportNode);
            }
         }
      }

      this._ast.program.body.push(...pseudoExportNodes);
   }

   /**
    * Traverse doc comments in given file.
    *
    * @private
    */
   static _traverseOld()
   {
      this._inspectExportDefaultDeclaration();
      this._inspectExportNamedDeclaration();

      this._eventbus.trigger('typhonjs:ast:walker:traverse', this._ast,
      {
         enterNode: (node, parent) =>
         {
            try
            {
               this._push(node, parent);
            }
            catch (fatalError)
            {
               switch (this._handleError)
               {
                  case 'log':
                     this._eventbus.trigger('tjsdoc:system:invalid:code:add',
                      { filePath: this.filePath, node, fatalError });
                     break;

                  case 'throw':
                     throw fatalError;
               }
            }
         }
      });
   }
}
