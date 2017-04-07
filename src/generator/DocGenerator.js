import * as Docs  from '../doc/';

/**
 * Provides a symbol to store checking if already covered.
 * @type {Symbol}
 * @ignore
 */
const s_ALREADY = Symbol('already');

// TODO REMOVE: temporary variable for debug statements.
const s_DEBUG = false;

/**
 * Doc generator. Provides static doc object generation for main source files inserting into the given DocDB.
 *
 * @example
 * DocGenerator.resetAndTraverse(ast, docDB, pathResolver, eventbus);
 */
export default class DocGenerator
{
   /**
    * Stores an array of already processed class nodes.
    * @type {ASTNode[]}
    * @private
    */
   static _processedClassNodes = [];

   /**
    * Stores export nodes that need to be resolved in a second pass.
    * @type {ASTNode[]}
    * @private
    */
   static _exportNodesPass = [];

   /**
    * Wires up the event binding to get DocGenerator.
    *
    * @param {PluginEvent} ev - The plugin event.
    */
   static onPreGenerate(ev)
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
       * Stores an array of already processed class nodes.
       * @type {ASTNode[]}
       * @private
       */
      this._processedClassNodes.length = 0;

      /**
       * Stores export nodes that need to be resolved in a second pass.
       * @type {ASTNode[]}
       * @private
       */
      this._exportNodesPass.length = 0;

      // Gets the current global / main plugin DocDB counter doc ID then increment it.
      const docID = eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get');

      // If code is defined then treat it as an memory doc otherwise a file doc.
      const doc = typeof code === 'string' ? Docs.MemoryDoc.create(docID, ast, ast, pathResolver, [],
       this._eventbus, code) : Docs.FileDoc.create(docID, ast, ast, pathResolver, [], this._eventbus);

      // Insert file or memory doc.
      this._docDB.insertDocObject(doc);

      /**
       * Store the docID for the memory / file and add it to all children doc data as `__moduleID__`.
       * @type {number}
       */
      this._moduleID = docID;

// if (s_DEBUG) { console.log('!! DocFactory - ctor - 0 - filepath: ' + pathResolver.filePath + '; ast: ' + JSON.stringify(ast)); }
//       this._inspectExportDefaultDeclaration(); // TODO REMOVE: in process of removing!
      this._inspectExportNamedDeclaration();
// if (s_DEBUG) { console.log('!! DocFactory - ctor - 1 - ast: ' + JSON.stringify(ast)); }

      // AST does not have a body or children nodes so only comments are potentially present.
      if (ast.program.body.length === 0 && ast.program.innerComments)
      {
         this._traverseComments(ast, null, ast.program.innerComments);
      }

      // this._traverseOrig();
      this._traverseNew();
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
      const result = this._decideType(tags, node);
      const type = result.type;

      node = result.node;

      if (!type) { return null; }

      if (type === 'ModuleClass')
      {
if (s_DEBUG) { console.log('!! DocFactory - _createDoc - ModuleClass - node: ' + JSON.stringify(node)); }
         this._processedClassNodes.push(node);
      }

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
if (s_DEBUG) { console.log('!! DocFactory - _decideClassMethodDefinitionType - filePath: ' + this.filePath); }
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

            // Do nothing; TODO VERIFY: if any processing is necessary (mleahy)
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

         //TODO REMOVE: test statement
         // if (exportNode.specifiers.length === 0)
         // {
         //    console.log('!! DocFactory - _inspectExportNamedDeclaration - GOT HERE - exportNode: ' + JSON.stringify(exportNode));
         // }
      }

      this._ast.program.body.push(...pseudoExportNodes);
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
if (s_DEBUG) { console.log('DocFactory - _isExportSecondPass - adding default export 2nd pass node: ' + JSON.stringify(node)); }
            this._exportNodesPass.push(node);
            return true;
         }
      }
//       else if (node.type === 'ExportNamedDeclaration')
//       {
//          if ((node.declaration && node.declaration.type === 'VariableDeclaration'))// || node.specifiers.length > 0)
//          {
// if (s_DEBUG) { console.log('DocFactory - _isExportSecondPass - adding named export 2nd pass node: ' + JSON.stringify(node)); }
//             this._exportNodesPass.push(node);
//             return true;
//          }
//       }

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

   static _processDefaultExport(exportNode)
   {
      let targetClassName = null;
      let targetVariableName = null;
      let pseudoClassExport;

if (s_DEBUG) { console.log('!! DocFactory - _processDefaultExportNew - exportNode: ' + JSON.stringify(exportNode)); }
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

if (s_DEBUG) { console.log('!! DocFactory - _processDefaultExportNew - 0 - targetClassName: ' + targetClassName + '; targetVariableName: ' + targetVariableName + '; pseudoClassExport: ' + pseudoClassExport); }

      // const classNode = this._eventbus.triggerSync('tjsdoc:system:ast:class:declaration:find', this._ast,
      //  targetClassName);

      const classDoc = this._docDB.find({ name: targetClassName, filePath: this.filePath });

      if (Array.isArray(classDoc) && classDoc.length > 0)
      {
if (s_DEBUG) { console.log('!! DocFactory - _processDefaultExportNew - 1 - classNode'); }
         classDoc[0].importStyle = pseudoClassExport ? null : targetClassName;
         classDoc[0].export = true;

         // Synthesize a virtual variable doc from `exportNode`. If there is an existing variable doc then modify
         // the existing variable doc with the export semantics, but only if `@ignore` is not included in the comments
         // for `exportNode`.
         if (targetVariableName)
         {
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

            virtualVarDoc._value.export = true;
            virtualVarDoc._value.importStyle = targetVariableName;
            virtualVarDoc._value.type = { types: [`${this.filePath}~${targetClassName}`] };

if (s_DEBUG) { console.log('!! DocFactory - _processDefaultExportNew - 1A - virtualVarNode: ' + JSON.stringify(virtualVarNode)); }
if (s_DEBUG) { console.log('!! DocFactory - _processDefaultExportNew - 1B - virtualVarDoc: ' + JSON.stringify(virtualVarDoc._value)); }

            // Search for an existing variable doc with the same name.
            const existingVarDoc = this._docDB.find(
             { kind: 'variable', name: targetVariableName, filePath: this.filePath });

            // If there is an existing variable doc update it with the export data.
            if (Array.isArray(existingVarDoc) && existingVarDoc.length > 0)
            {
               existingVarDoc[0].description += `\n${virtualVarDoc._value.description}`;
               existingVarDoc[0].export = true;
               existingVarDoc[0].importStyle = targetVariableName;
               existingVarDoc[0].type = { types: [`${this.filePath}~${targetClassName}`] };
               existingVarDoc[0].ignore = false;
if (s_DEBUG) { console.log('!! DocFactory - _processDefaultExportNew - 1C - modifying existing variable - existingVarDoc: ' + JSON.stringify(existingVarDoc)); }
            }
            else
            {
               // No existing variable doc has been found, so insert the exported virtual variable doc.
               this._docDB.insertDocObject(virtualVarDoc);

if (s_DEBUG) { console.log('!! DocFactory - _processDefaultExportNew - 1D - synthesizing new variable doc to export - virtualVarDoc: ' + JSON.stringify(virtualVarDoc)); }
            }
         }
      }

      const funcDoc = this._docDB.find({ name: exportNode.declaration.name, filePath: this.filePath });

      if (Array.isArray(funcDoc) && funcDoc.length > 0)
      {
if (s_DEBUG) { console.log('!! DocFactory - _processDefaultExportNew - 2 - functionNode'); }
         funcDoc[0].importStyle = exportNode.declaration.name;
         funcDoc[0].export = true;
         funcDoc[0].ignore = false;
      }

      const varDoc = this._docDB.find({ name: exportNode.declaration.name, filePath: this.filePath });

      if (Array.isArray(varDoc) && varDoc.length > 0)
      {
if (s_DEBUG) { console.log('!! DocFactory - _processDefaultExportNew - 3 - variableNode'); }
         varDoc[0].importStyle = exportNode.declaration.name;
         varDoc[0].export = true;
         varDoc[0].ignore = false;
      }
   }

   static _processExports()
   {
      for (const exportNode of this._exportNodesPass)
      {
         let exportNodeHasIgnoreTag = false;

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

   static _processNamedExport(exportNode)
   {
      if (exportNode.declaration && exportNode.declaration.type === 'VariableDeclaration')
      {
         for (const declaration of exportNode.declaration.declarations)
         {
            if (!declaration.init || declaration.init.type !== 'NewExpression') { continue; }

            // const classNode = this._eventbus.triggerSync('tjsdoc:system:ast:class:declaration:find', this._ast,
            //  declaration.init.callee.name);

            const targetClassName = declaration.init.callee.name;

            const classDoc = this._docDB.find({ name: targetClassName, filePath: this.filePath });

            if (Array.isArray(classDoc) && classDoc.length > 0)
            {
if (s_DEBUG) { console.log('!! DocGenerator - _processNamedExportNew - 1 - classNode'); }
               classDoc[0].export = true;
               classDoc[0].ignore = false;
               classDoc[0].importStyle = targetClassName;
            }

            // if (classNode)
            // {
            //    const pseudoExportNode = this._copy(exportNode);
            //
            //    pseudoExportNode.declaration = this._copy(classNode);
            //    pseudoExportNode.leadingComments = null;
            //    pseudoExportNodes.push(pseudoExportNode);
            //    pseudoExportNode.declaration.__PseudoExport__ = true;
            //
            //    this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', classNode);
            // }
         }

         return;
      }

//       for (const specifier of exportNode.specifiers)
//       {
//          if (specifier.type !== 'ExportSpecifier') { continue; }
//
//          let targetClassName = null;
//          let pseudoClassExport;
//
//          // const varNode = this._eventbus.triggerSync('tjsdoc:system:ast:variable:declaration:new:expression:find',
//          //    this._ast, specifier.exported.name);
//
//          const varDoc = this._docDB.find({ name: specifier.exported.name, filePath: this.filePath });
//
//          if (Array.isArray(varDoc) && varDoc.length > 0)
//          {
// if (s_DEBUG) { console.log('!! DocGenerator - _processDefaultExportNew - 2 - varDoc'); }
//             varDoc[0].importStyle = exportNode.declaration.name;
//             varDoc[0].export = true;
//             varDoc[0].ignore = false;
//
//             targetClassName = varNode.declarations[0].init.callee.name;
//             pseudoClassExport = true;
//
//             const pseudoExportNode = this._copy(exportNode);
//
//             pseudoExportNode.declaration = this._copy(varNode);
//             pseudoExportNode.specifiers = null;
//             pseudoExportNodes.push(pseudoExportNode);
//
//             this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', varNode);
//          }
//          else
//          {
//             targetClassName = specifier.exported.name;
//             pseudoClassExport = false;
//          }
//
//          if (varNode)
//          {
//             targetClassName = varNode.declarations[0].init.callee.name;
//             pseudoClassExport = true;
//
//             const pseudoExportNode = this._copy(exportNode);
//
//             pseudoExportNode.declaration = this._copy(varNode);
//             pseudoExportNode.specifiers = null;
//             pseudoExportNodes.push(pseudoExportNode);
//
//             this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', varNode);
//          }
//          else
//          {
//             targetClassName = specifier.exported.name;
//             pseudoClassExport = false;
//          }
//
//          const classNode = this._eventbus.triggerSync('tjsdoc:system:ast:class:declaration:find', this._ast,
//             targetClassName);
//
//          if (classNode)
//          {
//             const pseudoExportNode = this._copy(exportNode);
//
//             pseudoExportNode.declaration = this._copy(classNode);
//             pseudoExportNode.leadingComments = null;
//             pseudoExportNode.specifiers = null;
//             pseudoExportNode.declaration.__PseudoExport__ = pseudoClassExport;
//
//             pseudoExportNodes.push(pseudoExportNode);
//
//             this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', classNode);
//          }
//
//          const functionNode = this._eventbus.triggerSync('tjsdoc:system:ast:function:declaration:find', this._ast,
//             specifier.exported.name);
//
//          if (functionNode)
//          {
//             const pseudoExportNode = this._copy(exportNode);
//
//             pseudoExportNode.declaration = this._copy(functionNode);
//             pseudoExportNode.leadingComments = null;
//             pseudoExportNode.specifiers = null;
//
//             this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', functionNode);
//
//             pseudoExportNodes.push(pseudoExportNode);
//          }
//
//          const variableNode = this._eventbus.triggerSync('tjsdoc:system:ast:variable:declaration:find', this._ast,
//             specifier.exported.name);
//
//          if (variableNode)
//          {
//             const pseudoExportNode = this._copy(exportNode);
//
//             pseudoExportNode.declaration = this._copy(variableNode);
//             pseudoExportNode.leadingComments = null;
//             pseudoExportNode.specifiers = null;
//
//             this._eventbus.trigger('tjsdoc:system:ast:node:sanitize', variableNode);
//
//             pseudoExportNodes.push(pseudoExportNode);
//          }
//       }
   }

   /**
    * Push a node for generator processing.
    *
    * @param {ASTNode} node - target node.
    *
    * @param {ASTNode} parentNode - parent node of target node.
    */
   static pushNew(node, parentNode)
   {
      if (node === this._ast) { return; }

      if (node[s_ALREADY]) { return; }

      const isLastNodeInParent = this._isLastNodeInParent(node, parentNode);

      node[s_ALREADY] = true;

      Reflect.defineProperty(node, 'parent', { value: parentNode });

      // Unwrap export declaration
      switch (node.type)
      {
         case 'ExportDefaultDeclaration':
         case 'ExportNamedDeclaration':
            parentNode = node;
            node = this._unwrapExportDeclaration(node);

            if (!node) { return; }

            node[s_ALREADY] = true;

            Reflect.defineProperty(node, 'parent', { value: parentNode });
            break;
      }

      // If node has decorators leading comments are attached to decorators.
      if (node.decorators && node.decorators[0].leadingComments)
      {
         if (!node.leadingComments || !node.leadingComments.length)
         {
            node.leadingComments = node.decorators[0].leadingComments;
         }
      }

      this._traverseComments(parentNode, node, node.leadingComments);

      // For trailing comments traverse with only last node preventing duplication of trailing comments.
      if (node.trailingComments && isLastNodeInParent)
      {
         this._traverseComments(parentNode, null, node.trailingComments);
      }
   }

   /**
    * Push a node for generator processing.
    *
    * @param {ASTNode} node - target node.
    *
    * @param {ASTNode} parentNode - parent node of target node.
    */
   static pushOrig(node, parentNode)
   {
      if (node === this._ast) { return; }

      if (node[s_ALREADY]) { return; }

      const isLastNodeInParent = this._isLastNodeInParent(node, parentNode);

      node[s_ALREADY] = true;

      Reflect.defineProperty(node, 'parent', { value: parentNode });

      // Unwrap export declaration
      switch (node.type)
      {
         case 'ExportDefaultDeclaration':
         case 'ExportNamedDeclaration':
            parentNode = node;
            node = this._unwrapExportDeclaration(node);

            if (!node) { return; }

            node[s_ALREADY] = true;

            Reflect.defineProperty(node, 'parent', { value: parentNode });
            break;
      }

      // If node has decorators leading comments are attached to decorators.
      if (node.decorators && node.decorators[0].leadingComments)
      {
         if (!node.leadingComments || !node.leadingComments.length)
         {
            node.leadingComments = node.decorators[0].leadingComments;
         }
      }

      this._traverseComments(parentNode, node, node.leadingComments);

      // For trailing comments traverse with only last node preventing duplication of trailing comments.
      if (node.trailingComments && isLastNodeInParent)
      {
         this._traverseComments(parentNode, null, node.trailingComments);
      }
   }

   /**
    * Traverse doc comments in given file.
    *
    * @private
    */
   static _traverseNew()
   {
const startDocID = this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:get');

      this._eventbus.trigger('typhonjs:ast:walker:traverse', this._ast,
      {
         enterNode: (node, parent) =>
         {
            try
            {
               // Some export nodes are resolved in a second pass.
               if (this._isExportSecondPass(node)) { return null; }

               this.pushNew(node, parent);
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

      this._processExports();

const totalDocsProcessed = this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:get') - startDocID;

if (s_DEBUG) { console.log('!! DocGenerator - _traverseNew - totalDocsProcessed: ' + totalDocsProcessed); }
if (s_DEBUG) { console.log('!! DocGenerator - _traverseNew - docDB: ' + JSON.stringify(this._docDB.find())); }
   }

   /**
    * Traverse doc comments in given file.
    *
    * @private
    */
   static _traverseOrig()
   {
const startDocID = this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:get');

      this._eventbus.trigger('typhonjs:ast:walker:traverse', this._ast,
      {
         enterNode: (node, parent) =>
         {
            try
            {
               this.pushOrig(node, parent);
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

const totalDocsProcessed = this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:get') - startDocID;

if (s_DEBUG) { console.log('!! DocGenerator - _traverseOrig - totalDocsProcessed: ' + totalDocsProcessed); }
if (s_DEBUG) { console.log('!! DocGenerator - _traverseOrig - docDB: ' + JSON.stringify(this._docDB.find())); }
   }

   /**
    * Traverses comments of node and creates any applicable doc objects.
    *
    * @param {ASTNode|AST} parentNode - parent of target node.
    *
    * @param {?ASTNode} node - target node.
    *
    * @param {ASTNode[]} comments - comment nodes.
    *
    * @private
    */
   static _traverseComments(parentNode, node, comments)
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

         let doc;

         if (comment === lastComment)
         {
            doc = this._createDoc(node, tags);
         }
         else
         {
            const virtualNode = {};

            Reflect.defineProperty(virtualNode, 'parent', { value: parentNode });

            doc = this._createDoc(virtualNode, tags);
         }

         // Insert doc and destroy.
         if (doc) { this._docDB.insertDocObject(doc); }
      }
   }

   /**
    * Unwraps exported node.
    *
    * @param {ASTNode} node - target node that is export declaration node.
    *
    * @returns {ASTNode|null} unwrapped child node of exported node.
    * @private
    */
   static _unwrapExportDeclaration(node)
   {
      // e.g. `export A from './A.js'` has no declaration
      if (!node.declaration) { return null; }

      const exportedASTNode = node.declaration;

      if (!exportedASTNode.leadingComments) { exportedASTNode.leadingComments = []; }

      exportedASTNode.leadingComments.push(...node.leadingComments || []);

      if (!exportedASTNode.trailingComments) { exportedASTNode.trailingComments = []; }

      exportedASTNode.trailingComments.push(...node.trailingComments || []);

      return exportedASTNode;
   }
}
