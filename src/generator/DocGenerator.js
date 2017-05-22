import * as Docs  from '../doc/';

/**
 * Doc generator. Provides static doc object generation for main source files incrementally inserting into the given
 * DocDB. The core algorithm for parsing AST is a 2-pass system marking certain export nodes for a second pass
 * which reference module variables and new class creation. The first pass adds all the doc objects that can be
 * immediately processed to the given DocDB. The second pass will then work over all remaining export nodes which
 * reference previously processed doc objects and perform updates on the existing doc objects for any additional export
 * semantics.
 *
 * The two pass algorithm is preferred as it doesn't require AST modification or copying AST nodes which
 * is necessary for a 1-pass algorithm. The updates to existing doc objects include modifying `export` / `importStyle`
 * which is set in `ModuleDocBase` and `ignore` which is set in `DocBase`. It should be noted that if a module variable
 * or class has the @ignore tag, but is exported the export has higher precedence and will set the doc object to not
 * be ignored unless the @ignore tag is also present on the export. If @ignore is added to any export nodes it is not
 * processed in the second pass.
 *
 * An event binding, `tjsdoc:system:doc:generator:get` is available which simply returns DocGenerator. This is used in
 * `tjsdoc-runtime-common` / `GenerateDocData` which controls the doc generation process providing additional event
 * bindings for generating docs for main and test sources along with creating a DocDB or using one that is passed into
 * these bindings along with generating any AST for source to process.
 *
 * The main entry point for doc generation is `resetAndTraverse`. It should be noted that to process in memory code
 * the final `code` parameter should include the in memory source otherwise if this is not provided the AST passed in
 * is considered a source code from a file.
 *
 * Each doc object created gets a unique ID which is retrieved by the event binding
 * `tjsdoc:data:docdb:current:id:increment:get` which is the main DocDB added to the eventbus. This isn't necessarily
 * the given DocDB which is being processed. By getting the incremented unique ID from the main DocDB this allows
 * all doc objects generated to have a consistent ID which allows easy merging with other DocDB instances (like the main
 * one!).
 *
 * Error handling has two options: `log` and `throw` with the default to throw any errors encountered. However in
 * standard doc object processing `log` is passed in for `handleError` in `resetAndTraverse` which will post events
 * by `tjsdoc:system:invalid:code:add` which adds a log message to `InvalidCodeLogger` from `tjsdoc-runtime-common`.
 *
 * For the time being the older 1-pass algorithm is still available for testing purposes and is located in
 * `DocGeneratorOld`. To enable the older 1-pass algorithm alter `./src/index.js` and comment out adding `DocGenerator`
 * for `DocGeneratorOld`. The older 1-pass algorithm will be removed after an expanded set of docs proves the 2-pass
 * algorithm is thorough.
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
    * Resets DocGenerator and traverses code for doc object / docDB insertion.
    *
    * @param {AST}            ast - AST of source code.
    *
    * @param {DocDB}          docDB - The target DocDB.
    *
    * @param {PathResolver}   pathResolver - The path resolver for the source code.
    *
    * @param {EventProxy}     eventbus - An event proxy for the plugin eventbus.
    *
    * @param {string}         [handleError='throw'] - Determines how to handle errors. Options are `log` and `throw`
    *                                                 with the default being to throw any errors encountered.
    *
    * @param {String}         [code] - Designates that the ast is from an in memory source rather than a file.
    *
    * @param {function}       [docFilter] - An optional function invoked with the static doc before inserting into the
    *                                       given DocDB.
    */
   static resetAndTraverse(
    { ast, docDB, pathResolver, eventbus, handleError = 'throw', code = void 0, docFilter = void 0 } = {})
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

      /**
       * Optional function to invoke before a static doc is added to the given DocDB.
       * @type {Function}
       * @private
       */
      this._docFilter = docFilter;

      // Reset 2nd pass export tracking array.
      this._exportNodesPass.length = 0;

      // Gets the current global / main plugin DocDB counter doc ID then increment it.
      const docID = eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get');

      // If code is defined then treat it as an memory doc otherwise a file doc.
      const staticDoc = typeof code === 'string' ? Docs.ModuleMemoryDoc.create(docID, ast, ast, pathResolver, [],
       this._eventbus, code) : Docs.ModuleFileDoc.create(docID, ast, ast, pathResolver, [], this._eventbus);

      // Insert file or memory doc and reset.
      this._insertStaticDoc(staticDoc);

      /**
       * Store the docID for the memory / file and add it to all children doc data as `__moduleID__`.
       * @type {number}
       */
      this._moduleID = docID;

      // AST does not have a body or children nodes so only comments are potentially present.
      if (ast.program.body.length === 0 && ast.program.innerComments)
      {
         this._traverseComments(void 0, ast, ast.program.innerComments);
      }

      // Performs the two pass traversal algorithm.
      this._traverse();

      // Reset statically stored data after traversal to make sure all data goes out of scope.
      this._ast = void 0;
      this._docDB = void 0;
      this._pathResolver = void 0;
      this._eventbus = void 0;
      this._handleError = void 0;
      this._moduleID = void 0;
      this._exportNodesPass.length = 0;
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
    * @param {ASTNode} node - Target node that is an expression statement node.
    *
    * @returns {DocObjectType|undefined} Decided DocObjectType or undefined.
    * @private
    */
   static _decideExpressionStatementType(node)
   {
      if (!node.expression.right) { return void 0; }

      // Add parent `node` to `node.expression`.
      Reflect.defineProperty(node.expression, 'parent', { value: node });

      // If the expression is a member expression with `this` as the left hand type determine if
      if (node.expression.left.type === 'MemberExpression' && node.expression.left.object.type === 'ThisExpression')
      {
         const classNode = this._findUp(node.expression, ['ClassExpression', 'ClassDeclaration']);

         // No class node was found in an upward search. In certain situations this could be a function meant to
         // be applied with a particular context for `this`. However, it's not considered a member doc node.
         if (!classNode) { return void 0; }

         node.expression[s_ALREADY] = true;

         return { type: 'ClassMember', node: node.expression };
      }
      else
      {
         return void 0;
      }
   }

   /**
    * Decide ModuleFunction doc object type from arrow function expression nodes from the top level body.
    *
    * @param {ASTNode} node - Target node that is an arrow function expression node.
    *
    * @returns {DocObjectType|undefined} Decided DocObjectType or undefined.
    * @private
    */
   static _decideModuleArrowFunctionExpressionType(node)
   {
      if (!this._isTopDepthInBody(node)) { return void 0; }

      return { type: 'ModuleFunction', node };
   }

   /**
    * Decide ModuleAssignment doc object type from `AssignmentExpression` nodes from the top level body. If the right
    * node type is `ArrowFunctionExpression`, `ClassExpression` or `FunctionExpression` The inner type and node is
    * returned as `ModuleClass` or `ModuleFunction` types with the inner node.
    *
    * @example
    * export default functionName = function() {}
    * export default functionName = () => {}
    * export default ClassName = class {}
    *
    * @param {ASTNode} node - Target node that is an assignment node.
    *
    * @returns {DocObjectType|undefined} Decided DocObjectType or undefined.
    * @private
    */
   static _decideModuleAssignmentType(node)
   {
      if (!this._isTopDepthInBody(node)) { return void 0; }

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
    * Decide ModuleClass doc object type from class declaration nodes. These nodes must be in the AST body / top level.
    *
    * @param {ASTNode} node - Target node that is a class declaration node.
    *
    * @returns {DocObjectType|undefined} Decided DocObjectType or undefined.
    * @private
    */
   static _decideModuleClassDeclarationType(node)
   {
      if (!this._isTopDepthInBody(node)) { return void 0; }

      return { type: 'ModuleClass', node };
   }

   /**
    * Decide ModuleFunction doc object type from function declaration nodes. These nodes must be in the AST body / top
    * level.
    *
    * @param {ASTNode} node - Target node that is a function declaration node.
    *
    * @returns {DocObjectType} Decided DocObjectType or undefined.
    * @private
    */
   static _decideModuleFunctionDeclarationType(node)
   {
      if (!this._isTopDepthInBody(node)) { return void 0; }

      return { type: 'ModuleFunction', node };
   }

   /**
    * Decide ModuleFunction doc object type from function expression nodes. These nodes must be in the AST body / top
    * level.
    *
    * @param {ASTNode} node - Target node that is a function expression node.
    *
    * @returns {DocObjectType|undefined} Decided DocObjectType or undefined.
    * @private
    */
   static _decideModuleFunctionExpressionType(node)
   {
      if (!node.async || !this._isTopDepthInBody(node)) { return void 0; }

      return { type: 'ModuleFunction', node };
   }

   /**
    * Decide ModuleVariable doc object type from `VariableDeclaration` nodes from the top level body. If the right
    * node type is `ArrowFunctionExpression`, `ClassExpression` or `FunctionExpression` The inner type and node is
    * returned as `ModuleClass` or `ModuleFunction` types.
    *
    * @param {ASTNode} node - Target node that is variable declaration node.
    *
    * @returns {DocObjectType|undefined} Decided DocObjectType or undefined.
    * @private
    */
   static _decideModuleVariableType(node)
   {
      if (!this._isTopDepthInBody(node)) { return void 0; }

      if (!node.declarations[0].init) { return void 0; }

      let innerType = void 0;

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
    * Decide doc object type by using the given node and documentation tags.
    *
    * @param {ASTNode}  node - Target node.
    *
    * @param {Tag[]}    tags - Documentation Tags of the node.
    *
    * @returns {DocObjectType|undefined} Decided DocObjectType or undefined.
    * @private
    */
   static _decideType(node, tags)
   {
      // First process tags to find any virtual doc object types. Immediately return if a virtual doc object is found.
      for (const tag of tags)
      {
         const tagName = tag.tagName;

         switch (tagName)
         {
            case '@typedef':
               return { type: 'VirtualTypedef', node };

            case '@external':
               return { type: 'VirtualExternal', node };
         }
      }

      // Process the actual node for any doc object types.
      switch (node.type)
      {
         case 'ArrowFunctionExpression':
            return this._decideModuleArrowFunctionExpressionType(node);

         case 'AssignmentExpression':
            return this._decideModuleAssignmentType(node);

         case 'ClassDeclaration':
            return this._decideModuleClassDeclarationType(node);

         case 'ClassMethod':
            return { type: 'ClassMethod', node };

         case 'ClassProperty':
            return { type: 'ClassProperty', node };

         case 'ExpressionStatement':
            return this._decideExpressionStatementType(node);

         case 'FunctionDeclaration':
            return this._decideModuleFunctionDeclarationType(node);

         case 'FunctionExpression':
            return this._decideModuleFunctionExpressionType(node);

         case 'VariableDeclaration':
            return this._decideModuleVariableType(node);
      }

      return void 0;
   }

   /**
    * Find node while traversing up the parent tree. This is used to verify that a parent node exists such as
    * ClassDeclaration / ClassExpression.
    *
    * @param {ASTNode}  node - Starting node.
    *
    * @param {string[]} types - ASTNode types to find.
    *
    * @returns {ASTNode|undefined} The first node matched.
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

      return void 0;
   }

   /**
    * Inserts a doc into the associated DocDB after running any optionally supplied doc filter.
    *
    * @param {StaticDoc}   staticDoc - Static doc object to insert into the associated DocDB.
    *
    * @private
    */
   static _insertStaticDoc(staticDoc)
   {
      this._docDB.insertStaticDoc(staticDoc, this._docFilter);
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
         // Any named export with specifiers needs to be processed in a second pass.
         if (node.specifiers.length > 0)
         {
            this._exportNodesPass.push(node);
            return true;
         }

         // Any named export which references a variable that is a new expression node (new Class()) needs to be
         // processed in second pass.
         if ((node.declaration && node.declaration.type === 'VariableDeclaration'))
         {
            for (const declaration of node.declaration.declarations)
            {
               if (!declaration.init || declaration.init.type !== 'NewExpression') { continue; }

               // Find the matching class node and if found then add this export node for further processing.
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
    * Determine if node is the last in parent body array.
    *
    * @param {ASTNode} node - Target node.
    *
    * @param {ASTNode} parentNode - Target parent node.
    *
    * @returns {boolean} True if the node is last in parent body array.
    * @private
    */
   static _isLastNodeInParent(node, parentNode)
   {
      if (parentNode && Array.isArray(parentNode.body))
      {
         const lastNode = parentNode.body[parentNode.body.length - 1];
         return node === lastNode;
      }

      return false;
   }

   /**
    * Determine if the node is at the top program node body. Direct child nodes of exports are considered top level.
    *
    * @param {ASTNode} node - Target node.
    *
    * @returns {boolean} True if the node is in top program node body.
    * @private
    */
   static _isTopDepthInBody(node)
   {
      const parentNode = node.parent;

      switch (parentNode.type)
      {
         case 'ExportDefaultDeclaration':
         case 'ExportNamedDeclaration':
            node = parentNode;
            break;
      }

      // Babylon has a `Program` node that contains the main program `body`.
      return node.parent.type === 'Program';
   }

   /**
    * Performs second pass processing of default export nodes. The target class, function or variable referenced
    * by the export node is found in the DocDB and the existing DocObject is updated with any applicable export
    * semantics.
    *
    * If a class is being exported by a new expression call the class and a newly synthesized variable node is output.
    * The variable node for implicit exports such as `export default new MyClass()` is named `myClass`.
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

    * @param {ASTNode}  exportNode - Target default export to process.
    *
    * @private
    * @todo support function export.
    */
   static _processDefaultExport(exportNode)
   {
      const filePath = this._pathResolver.filePath;
      let targetClassName = void 0;
      let targetVariableName = void 0;
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

            // Determine variable name to synthesize from the target class name with the first character converted to
            // lower case.
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

      if (classDoc.length > 0)
      {
         classDoc[0].importStyle = pseudoClassExport ? null : targetClassName;
         classDoc[0].export = true;
         classDoc[0].ignore = false;

         if (targetVariableName) { this._updateOrCreateVarDoc(targetVariableName, targetClassName, exportNode); }
      }

      const funcDoc = this._docDB.find({ name: exportNode.declaration.name, filePath });

      if (funcDoc.length > 0)
      {
         funcDoc[0].importStyle = exportNode.declaration.name;
         funcDoc[0].export = true;
         funcDoc[0].ignore = false;
      }

      const varDoc = this._docDB.find({ name: exportNode.declaration.name, filePath });

      if (varDoc.length > 0)
      {
         varDoc[0].importStyle = exportNode.declaration.name;
         varDoc[0].export = true;
         varDoc[0].ignore = false;
      }
   }

   /**
    * Dispatches second pass processing for export nodes that require further processing. Leading comments are parsed
    * for the existence of the `@ignore` tag. If it is found then second pass processing is skipped for that export
    * node.
    *
    * @private
    */
   static _processExports()
   {
      for (const exportNode of this._exportNodesPass)
      {
         let exportNodeHasIgnoreTag = false;

         // Parse any leading comments from the given export node to find `@ignore`. Second pass processing is skipped
         // for export nodes which have an `@ignore` documentation tag.
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
    * Performs second pass processing of named export nodes. The target class, function or variable referenced
    * by the export node is found in the DocDB and the existing DocObject is updated with any applicable export
    * semantics.
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
      const filePath = this._pathResolver.filePath;

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

         let targetClassName = void 0;
         let pseudoClassExport;

         const varNode = this._eventbus.triggerSync('tjsdoc:system:ast:variable:declaration:new:expression:find',
          this._ast, specifier.exported.name);

         if (varNode)
         {
            const varDoc = this._docDB.find({ name: specifier.exported.name, filePath });

            if (varDoc.length > 0)
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

         if (classDoc.length > 0)
         {
            classDoc[0].importStyle = pseudoClassExport ? null : `{${targetClassName}}`;
            classDoc[0].export = true;
            classDoc[0].ignore = false;
         }

         const funcDoc = this._docDB.find({ name: specifier.exported.name, filePath });

         if (funcDoc.length > 0)
         {
            funcDoc[0].importStyle = `{${specifier.exported.name}}`;
            funcDoc[0].export = true;
            funcDoc[0].ignore = false;
         }

         const varDoc = this._docDB.find({ name: specifier.exported.name, filePath });

         if (varDoc.length > 0)
         {
            varDoc[0].importStyle = `{${specifier.exported.name}}`;
            varDoc[0].export = true;
            varDoc[0].ignore = false;
         }
      }
   }

   /**
    * Processes the AST node via any matched StaticDoc class which stores the doc object by node type. First
    * `_decideType` is invoked to determine if the given AST node is a valid doc object type. If so then it is
    * processed.
    *
    * @param {ASTNode}  node - Target node.
    *
    * @param {Tag[]}    tags - Doc tags of target node.
    *
    * @returns {StaticDoc} The static doc class which contains the currently processed doc object.
    *
    * @private
    */
   static _processNode(node, tags)
   {
      // Decide if there is a doc type to process based on tags and node.
      const result = this._decideType(node, tags);

      // No doc object type has been found so exit early.
      if (!result) { return void 0; }

      // Stores the associated StaticDoc for the give doc object type.
      let StaticDoc;

      // Select the StaticDoc for the given doc object type.
      switch (result.type)
      {
         case 'ClassMember':
            StaticDoc = Docs.ClassMemberDoc;
            break;

         case 'ClassMethod':
            StaticDoc = Docs.ClassMethodDoc;
            break;

         case 'ClassProperty':
            StaticDoc = Docs.ClassPropertyDoc;
            break;

         case 'ModuleAssignment':
            StaticDoc = Docs.ModuleAssignmentDoc;
            break;

         case 'ModuleClass':
            StaticDoc = Docs.ModuleClassDoc;
            break;

         case 'ModuleFunction':
            StaticDoc = Docs.ModuleFunctionDoc;
            break;

         case 'ModuleVariable':
            StaticDoc = Docs.ModuleVariableDoc;
            break;

         case 'VirtualExternal':
            StaticDoc = Docs.VirtualExternalDoc;
            break;

         case 'VirtualTypedef':
            StaticDoc = Docs.VirtualTypedefDoc;
            break;

         default:
            throw new Error(`Unexpected type: ${result.type}`);
      }

      // If no StaticDoc is found exit early.
      if (!StaticDoc) { return void 0; }

      // Create the static doc with the next global doc ID and current file / module ID.
      return StaticDoc.create(this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get'), this._moduleID,
       this._ast, result.node, this._pathResolver, tags, this._eventbus);
   }

   /**
    * Push a node for generator processing.
    *
    * @param {ASTNode} node - Target node.
    *
    * @param {ASTNode} parentNode - Parent node of target node.
    */
   static _push(node, parentNode)
   {
      if (node === this._ast) { return; }

      if (node[s_ALREADY]) { return; }

      const isLastNodeInParent = this._isLastNodeInParent(node, parentNode);

      node[s_ALREADY] = true;

      // Add parent to node to allow upward traversal.
      Reflect.defineProperty(node, 'parent', { value: parentNode });

      switch (node.type)
      {
         // Unwrap export declarations and traverse.
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
      const filePath = this._pathResolver.filePath;

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

      // Performs the 2nd pass of export nodes that need further processing.
      this._processExports();
   }

   /**
    * Traverses comments of node and creates any applicable doc objects.
    *
    * @param {?ASTNode}    node - Target node. If not supplied then a virtual node is created.
    *
    * @param {ASTNode}     parentNode - parent of target node.
    *
    * @param {ASTNode[]}   comments - comment nodes.
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

      // Synthesize undocument tag if no comments exist.
      if (comments.length === 0) { comments = [{ type: 'CommentBlock', value: '* @_undocument' }]; }

      const lastComment = comments[comments.length - 1];

      for (const comment of comments)
      {
         const tags = this._eventbus.triggerSync('tjsdoc:system:parser:comment:parse', comment);

         let staticDoc;

         if (comment === lastComment)
         {
            staticDoc = this._processNode(node, tags);
         }
         else
         {
            const virtualNode = {};

            Reflect.defineProperty(virtualNode, 'parent', { value: parentNode });

            staticDoc = this._processNode(virtualNode, tags);
         }

         // Insert doc and reset.
         if (staticDoc) { this._insertStaticDoc(staticDoc); }
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
         this._traverseComments(void 0, parentNode, node.trailingComments);
      }
   }

   /**
    * Unwraps exported node.
    *
    * @param {ASTNode} node - target node that is export declaration node.
    *
    * @param {boolean} isLastNodeInParent - Indicates the node is the last in its parent node body.
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
         this._traverseComments(void 0, node, trailingComments);
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
      const filePath = this._pathResolver.filePath;
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
      const existingVarDoc = this._docDB.find({ category: 'ModuleVariable', name: targetVariableName, filePath });

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
         this._insertStaticDoc(virtualVarDoc);
      }
   }
}

// Module private ---------------------------------------------------------------------------------------------------

/**
 * Provides a symbol to store checking if already covered.
 * @type {Symbol}
 * @ignore
 */
const s_ALREADY = Symbol('already');
