import * as Docs  from '../doc/';

/**
 * The old 1-pass doc generator. Provides static doc object generation for main source files incrementally inserting
 * into the given DocDB. This is the old 1-pass algorithm which is inefficient and difficult to understand / reason
 * about as is relies on rewriting the AST for export nodes which reference module variable and class declarations.
 *
 * An event binding, `tjsdoc:system:doc:generator:get` is available which simply returns DocGeneratorOld. This is used
 * in `tjsdoc-runtime-common` / `GenerateDocData` which controls the doc generation process providing additional event
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
 * TODO: remove this old 1-pass algorithm will be removed once the 2-pass algorithm goes through thorough testing.
 *
 * For the time being the older 1-pass algorithm is still available for testing purposes and is located in
 * `DocGeneratorOld`. To enable the older 1-pass algorithm alter `./src/index.js` and comment out adding `DocGenerator`
 * for `DocGeneratorOld`. The older 1-pass algorithm will be removed after an expanded set of docs proves the 2-pass
 * algorithm is thorough.
 *
 *
 * @example
 * DocGenerator.resetAndTraverse(ast, docDB, pathResolver, eventbus);
 */
export default class DocGeneratorOld
{
   /**
    * Stores an array of already processed class nodes. This is used to ensure that the sanitized AST ClassNode that
    * may be rewritten as an export node does not process any class methods or properties.
    * @type {ASTNode[]}
    * @private
    */
   static _processedClassNodes = [];

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

      // Reset tracking arrays.
      this._processedClassNodes.length = 0;

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
         this._traverseComments(null, ast, ast.program.innerComments);
      }

      // This is the nasty AST rewriting of the old 1-pass algorithm.
      this._inspectExportDefaultDeclaration();
      this._inspectExportNamedDeclaration();

      // Provides the old 1-pass algorithm
      this._traverse();

      // Reset statically stored data after traversal to make sure all data goes out of scope.
      this._ast = void 0;
      this._docDB = void 0;
      this._pathResolver = void 0;
      this._eventbus = void 0;
      this._handleError = void 0;
      this._moduleID = void 0;
      this._processedClassNodes.length = 0;
   }

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
    * Decide if the given node is a ClassMethod doc object type from method definition node.
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
    * Decide ModuleClass doc object type from class declaration nodes. These nodes must be in the AST body / top level.
    *
    * @param {ASTNode} node - target node that is class declaration node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   static _decideModuleClassDeclarationType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      return { type: 'ModuleClass', node };
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
            return this._decideModuleClassDeclarationType(node);

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
    * Processes the AST node via a StaticDoc class which stores the doc object by node type. First `_decideType` is
    * invoked to determine if the given AST node is a valid doc object. If so then it is processed.
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
      const result = this._decideType(tags, node);
      const type = result.type;

      node = result.node;

      if (!type) { return null; }

      // Store all ModuleClass nodes which provides an inclusion check for class properties / members.
      if (type === 'ModuleClass') { this._processedClassNodes.push(node); }

      let StaticDoc;

      // Select the StaticDoc for the give doc object type.
      switch (type)
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
            throw new Error(`unexpected type: ${type}`);
      }

      // If no StaticDoc is found exit early.
      if (!StaticDoc) { return null; }

      // Create the static doc with the next global doc ID and current file / module ID.
      return StaticDoc.create(this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get'), this._moduleID,
       this._ast, node, this._pathResolver, tags, this._eventbus);
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
    * Traverse doc comments in given file with the 1-pass algorithm rewriting AST nodes.
    *
    * @private
    */
   static _traverse()
   {
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
                      { filePath: this._pathResolver.filePath, node, fatalError });
                     break;

                  case 'throw':
                     throw fatalError;
               }
            }
         }
      });
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
}

// Module private ---------------------------------------------------------------------------------------------------

/**
 * Provides a symbol to store checking if already covered.
 * @type {Symbol}
 * @ignore
 */
const s_ALREADY = Symbol('already');
