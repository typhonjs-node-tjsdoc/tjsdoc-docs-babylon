import * as Docs  from '../doc/';

/**
 * Provides a symbol to store checking if already covered.
 * @type {Symbol}
 * @ignore
 */
const s_ALREADY = Symbol('already');

/**
 * Doc factory.
 *
 * @example
 * let factory = new DocFactory(ast, pathResolver, eventbus);
 * factory.push(node, parentNode);
 * let docData = factory.docData;
 */
export default class DocFactory
{
   /**
    * Instantiates DocFactory.
    *
    * @param {AST}            ast - AST of source code.
    *
    * @param {PathResolver}   pathResolver - The path resolver of source code.
    *
    * @param {EventProxy}     eventbus - An event proxy for the plugin eventbus.
    *
    * @param {String}         [code] - Designates that the ast is from an in memory source rather than a file.
    */
   constructor(ast, pathResolver, eventbus, code = void 0)
   {
      /**
       * AST of source code.
       * @type {AST}
       * @private
       */
      this._ast = ast;

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
       * The parsed DocObjects.
       * @type {DocObject[]}
       * @private
       */
      this._docData = [];

      /**
       * Stores an array of already processed class nodes.
       * @type {Array}
       * @private
       */
      this._processedClassNodes = [];

      // If code is defined then treat it as an memory doc otherwise a file doc.
      const doc = typeof code === 'string' ? new Docs.MemoryDoc(ast, ast, pathResolver, [], this._eventbus, code) :
       new Docs.FileDoc(ast, ast, pathResolver, [], this._eventbus);

      // Push file or memory doc.
      this._docData.push(doc.value);

      /**
       * Store the docID for the memory / file and add it to all children doc data as `__moduleID__`.
       * @type {number}
       */
      this._moduleID = doc.value.__docId__;

      this._inspectExportDefaultDeclaration();
      this._inspectExportNamedDeclaration();

      // AST does not have a body or children nodes so only comments are potentially present.
      if (ast.program.body.length === 0 && ast.program.innerComments)
      {
         const docData = this._traverseComments(ast, null, ast.program.innerComments);

         this._docData.push(...docData);
      }
   }

   /**
    * Deep copy object.
    *
    * @param {Object} obj - target object.
    *
    * @return {Object} copied object.
    * @private
    */
   _copy(obj)
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
   _createDoc(node, tags)
   {
      const result = this._decideType(tags, node);
      const type = result.type;

      node = result.node;

      if (!type) { return null; }

      if (type === 'Class')
      {
         this._processedClassNodes.push(node);
      }

      let Clazz;

      switch (type)
      {
         case 'Assignment':
            Clazz = Docs.AssignmentDoc;
            break;

         case 'Class':
            Clazz = Docs.ClassDoc;
            break;

         case 'ClassProperty':
            Clazz = Docs.ClassPropertyDoc;
            break;

         case 'External':
            Clazz = Docs.ExternalDoc;
            break;

         case 'Function':
            Clazz = Docs.FunctionDoc;
            break;

         case 'Member':
            Clazz = Docs.MemberDoc;
            break;

         case 'Method':
            Clazz = Docs.MethodDoc;
            break;

         case 'Typedef':
            Clazz = Docs.TypedefDoc;
            break;

         case 'Variable':
            Clazz = Docs.VariableDoc;
            break;

         default:
            throw new Error(`unexpected type: ${type}`);
      }

      if (!Clazz) { return null; }
      if (!node.type) { node.type = type; }

      return new Clazz(this._moduleID, this._ast, node, this._pathResolver, tags, this._eventbus);
   }

   /**
    * Decide doc object type from arrow function expression node.
    *
    * @param {ASTNode} node - target node that is arrow function expression node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   _decideArrowFunctionExpressionType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      return { type: 'Function', node };
   }

   /**
    * Decide doc object type from assignment node.
    *
    * @param {ASTNode} node - target node that is assignment node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   _decideAssignmentType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      let innerType;
      let innerNode;

      switch (node.right.type)
      {
         case 'FunctionExpression':
            innerType = 'Function';
            break;

         case 'ClassExpression':
            innerType = 'Class';
            break;

         default:
            return { type: 'Assignment', node };
      }

      /* eslint-disable prefer-const */
      innerNode = node.right;
      innerNode.id = this._copy(node.left.id || node.left.property);

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
   _decideClassDeclarationType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      return { type: 'Class', node };
   }

   /**
    * Decide doc object type from class property node.
    *
    * @param {ASTNode} node - target node that is classs property node.
    *
    * @returns {{type: ?string, node: ?ASTNode}} decided type.
    * @private
    */
   _decideClassPropertyType(node)
   {
      const classNode = this._findUp(node, ['ClassDeclaration', 'ClassExpression']);

      if (this._processedClassNodes.includes(classNode))
      {
         return { type: 'ClassProperty', node };
      }
      else
      {
         this._eventbus.trigger('log:warn', 'this class property is not in class', node);

         return { type: null, node: null };
      }
   }

   /**
    * Decide doc object type from expression statement node.
    *
    * @param {ASTNode} node - target node that is expression statement node.
    *
    * @returns {{type: ?string, node: ?ASTNode}} decided type.
    * @private
    */
   _decideExpressionStatementType(node)
   {
      const isTop = this._isTopDepthInBody(node, this._ast.program.body);

      Reflect.defineProperty(node.expression, 'parent', { value: node });

      node = node.expression;
      node[s_ALREADY] = true;

      let innerType;

      if (!node.right) { return { type: null, node: null }; }

      switch (node.right.type)
      {
         case 'FunctionExpression':
            innerType = 'Function';
            break;

         case 'ClassExpression':
            innerType = 'Class';
            break;

         default:
            if (node.left.type === 'MemberExpression' && node.left.object.type === 'ThisExpression')
            {
               const classNode = this._findUp(node, ['ClassExpression', 'ClassDeclaration']);

               // No class node was found in an upward search. In certain situations this could be a function meant to
               // be applied with a particular context for `this`. However, it's not considered a member doc node.
               if (classNode === null) { return { type: null, node: null }; }

               return { type: 'Member', node };
            }
            else
            {
               return { type: null, node: null };
            }
      }

      if (!isTop) { return { type: null, node: null }; }

      const innerNode = node.right;

      innerNode.id = this._copy(node.left.id || node.left.property);

      Reflect.defineProperty(innerNode, 'parent', { value: node });

      innerNode[s_ALREADY] = true;

      return { type: innerType, node: innerNode };
   }

   /**
    * Decide doc object type from function declaration node.
    *
    * @param {ASTNode} node - target node that is function declaration node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   _decideFunctionDeclarationType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      return { type: 'Function', node };
   }

   /**
    * Decide doc object type from function expression node.
    *
    * @param {ASTNode} node - target node that is function expression node.
    *
    * @returns {{type: string, node: ASTNode}} decided type.
    * @private
    */
   _decideFunctionExpressionType(node)
   {
      if (!node.async) { return { type: null, node: null }; }
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      return { type: 'Function', node };
   }

   /**
    * Decide doc object  type from method definition node.
    *
    * @param {ASTNode} node - target node that is method definition node.
    *
    * @returns {{type: ?string, node: ?ASTNode}} decided type.
    * @private
    */
   _decideMethodDefinitionType(node)
   {
      const classNode = this._findUp(node, ['ClassDeclaration', 'ClassExpression']);

      if (this._processedClassNodes.includes(classNode))
      {
         return { type: 'Method', node };
      }
      else
      {
         this._eventbus.trigger('log:warn', 'this method is not in class', node);

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
   _decideType(tags, node)
   {
      let type = null;

      for (const tag of tags)
      {
         const tagName = tag.tagName;

         switch (tagName)
         {
            case '@typedef':
               type = 'Typedef';
               break;

            case '@external':
               type = 'External';
               break;
         }
      }

      if (type) { return { type, node }; }

      if (!node) { return { type, node }; }

      switch (node.type)
      {
         case 'ClassDeclaration':
            return this._decideClassDeclarationType(node);

         case 'ClassMethod':
            return this._decideMethodDefinitionType(node);

         case 'ClassProperty':
            return this._decideClassPropertyType(node);

         case 'ExpressionStatement':
            return this._decideExpressionStatementType(node);

         case 'FunctionDeclaration':
            return this._decideFunctionDeclarationType(node);

         case 'FunctionExpression':
            return this._decideFunctionExpressionType(node);

         case 'VariableDeclaration':
            return this._decideVariableType(node);

         case 'AssignmentExpression':
            return this._decideAssignmentType(node);

         case 'ArrowFunctionExpression':
            return this._decideArrowFunctionExpressionType(node);
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
   _decideVariableType(node)
   {
      if (!this._isTopDepthInBody(node, this._ast.program.body)) { return { type: null, node: null }; }

      let innerType = null;
      let innerNode = null;

      if (!node.declarations[0].init) { return { type: innerType, node: innerNode }; }

      switch (node.declarations[0].init.type)
      {
         case 'FunctionExpression':
            innerType = 'Function';
            break;

         case 'ClassExpression':
            innerType = 'Class';
            break;

         case 'ArrowFunctionExpression':
            innerType = 'Function';
            break;

         default:
            return { type: 'Variable', node };
      }

      innerNode = node.declarations[0].init;
      innerNode.id = this._copy(node.declarations[0].id);

      Reflect.defineProperty(innerNode, 'parent', { value: node });

      innerNode[s_ALREADY] = true;

      return { type: innerType, node: innerNode };
   }

   /**
    * Gets the generated doc data.
    *
    * @returns {DocObject[]}
    */
   get docData()
   {
      return [...this._docData];
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
   _findUp(node, types)
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
   _inspectExportDefaultDeclaration()
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
               const varNode = this._eventbus.triggerSync('tjsdoc:ast:find:variable:declaration:new:expression',
                exportNode.declaration.name, this._ast);

               if (varNode)
               {
                  targetClassName = varNode.declarations[0].init.callee.name;
                  targetVariableName = exportNode.declaration.name;
                  pseudoClassExport = true;

                  this._eventbus.trigger('tjsdoc:ast:node:sanitize', varNode);
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
               this._eventbus.trigger('log:warn', `unknown export declaration type. type = "${
                exportNode.declaration.type}"`);
               break;
         }

         const classNode = this._eventbus.triggerSync('tjsdoc:ast:find:class:declaration', targetClassName, this._ast);

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
                'tjsdoc:ast:create:variable:declaration:new:expression', targetVariableName, targetClassName,
                 exportNode.loc);

               pseudoExportNodes.push(pseudoExportNode2);
            }

            this._eventbus.trigger('tjsdoc:ast:node:sanitize', classNode);
            this._eventbus.trigger('tjsdoc:ast:node:sanitize', exportNode);
         }

         const functionNode = this._eventbus.triggerSync('tjsdoc:ast:find:function:declaration',
          exportNode.declaration.name, this._ast);

         if (functionNode)
         {
            const pseudoExportNode = this._copy(exportNode);

            pseudoExportNode.declaration = this._copy(functionNode);

            this._eventbus.trigger('tjsdoc:ast:node:sanitize', exportNode);
            this._eventbus.trigger('tjsdoc:ast:node:sanitize', functionNode);

            pseudoExportNodes.push(pseudoExportNode);
         }

         const variableNode = this._eventbus.triggerSync('tjsdoc:ast:find:variable:declaration',
          exportNode.declaration.name, this._ast);

         if (variableNode)
         {
            const pseudoExportNode = this._copy(exportNode);

            pseudoExportNode.declaration = this._copy(variableNode);

            this._eventbus.trigger('tjsdoc:ast:node:sanitize', exportNode);
            this._eventbus.trigger('tjsdoc:ast:node:sanitize', variableNode);

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
   _inspectExportNamedDeclaration()
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

               const classNode = this._eventbus.triggerSync('tjsdoc:ast:find:class:declaration',
                declaration.init.callee.name, this._ast);

               if (classNode)
               {
                  const pseudoExportNode = this._copy(exportNode);

                  pseudoExportNode.declaration = this._copy(classNode);
                  pseudoExportNode.leadingComments = null;
                  pseudoExportNodes.push(pseudoExportNode);
                  pseudoExportNode.declaration.__PseudoExport__ = true;

                  this._eventbus.trigger('tjsdoc:ast:node:sanitize', classNode);
               }
            }
            continue;
         }

         for (const specifier of exportNode.specifiers)
         {
            if (specifier.type !== 'ExportSpecifier') { continue; }

            let targetClassName = null;
            let pseudoClassExport;

            const varNode = this._eventbus.triggerSync('tjsdoc:ast:find:variable:declaration:new:expression',
             specifier.exported.name, this._ast);

            if (varNode)
            {
               targetClassName = varNode.declarations[0].init.callee.name;
               pseudoClassExport = true;

               const pseudoExportNode = this._copy(exportNode);

               pseudoExportNode.declaration = this._copy(varNode);
               pseudoExportNode.specifiers = null;
               pseudoExportNodes.push(pseudoExportNode);

               this._eventbus.trigger('tjsdoc:ast:node:sanitize', varNode);
            }
            else
            {
               targetClassName = specifier.exported.name;
               pseudoClassExport = false;
            }

            const classNode = this._eventbus.triggerSync('tjsdoc:ast:find:class:declaration', targetClassName,
             this._ast);

            if (classNode)
            {
               const pseudoExportNode = this._copy(exportNode);

               pseudoExportNode.declaration = this._copy(classNode);
               pseudoExportNode.leadingComments = null;
               pseudoExportNode.specifiers = null;
               pseudoExportNode.declaration.__PseudoExport__ = pseudoClassExport;

               pseudoExportNodes.push(pseudoExportNode);

               this._eventbus.trigger('tjsdoc:ast:node:sanitize', classNode);
            }

            const functionNode = this._eventbus.triggerSync('tjsdoc:ast:find:function:declaration',
             specifier.exported.name, this._ast);

            if (functionNode)
            {
               const pseudoExportNode = this._copy(exportNode);

               pseudoExportNode.declaration = this._copy(functionNode);
               pseudoExportNode.leadingComments = null;
               pseudoExportNode.specifiers = null;

               this._eventbus.trigger('tjsdoc:ast:node:sanitize', functionNode);

               pseudoExportNodes.push(pseudoExportNode);
            }

            const variableNode = this._eventbus.triggerSync('tjsdoc:ast:find:variable:declaration',
             specifier.exported.name, this._ast);

            if (variableNode)
            {
               const pseudoExportNode = this._copy(exportNode);

               pseudoExportNode.declaration = this._copy(variableNode);
               pseudoExportNode.leadingComments = null;
               pseudoExportNode.specifiers = null;

               this._eventbus.trigger('tjsdoc:ast:node:sanitize', variableNode);

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
   _isLastNodeInParent(node, parentNode)
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
   _isTopDepthInBody(node, body)
   {
      if (!body) { return false; }
      if (!Array.isArray(body)) { return false; }

      const parentNode = node.parent;

      if (['ExportDefaultDeclaration', 'ExportNamedDeclaration'].includes(parentNode.type))
      {
         node = parentNode;
      }

      for (const _node of body)
      {
         if (node === _node) { return true; }
      }

      return false;
   }

   /**
    * Push a node for factory processing.
    *
    * @param {ASTNode} node - target node.
    *
    * @param {ASTNode} parentNode - parent node of target node.
    */
   push(node, parentNode)
   {
      if (node === this._ast) { return; }

      if (node[s_ALREADY]) { return; }

      const isLastNodeInParent = this._isLastNodeInParent(node, parentNode);

      node[s_ALREADY] = true;

      Reflect.defineProperty(node, 'parent', { value: parentNode });

      // unwrap export declaration
      if (['ExportDefaultDeclaration', 'ExportNamedDeclaration'].includes(node.type))
      {
         parentNode = node;
         node = this._unwrapExportDeclaration(node);

         if (!node) { return; }

         node[s_ALREADY] = true;

         Reflect.defineProperty(node, 'parent', { value: parentNode });
      }

      // if node has decorators, leading comments is attached to decorators.
      if (node.decorators && node.decorators[0].leadingComments)
      {
         if (!node.leadingComments || !node.leadingComments.length)
         {
            node.leadingComments = node.decorators[0].leadingComments;
         }
      }

      let docData = this._traverseComments(parentNode, node, node.leadingComments);

      this._docData.push(...docData);

      // for trailing comments. traverse with only last node, because prevent duplication of trailing comments.
      if (node.trailingComments && isLastNodeInParent)
      {
         docData = this._traverseComments(parentNode, null, node.trailingComments);

         this._docData.push(...docData);
      }
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
    * @returns {DocObject[]} created doc objects.
    *
    * @private
    */
   _traverseComments(parentNode, node, comments)
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
            if (this._eventbus.triggerSync('tjsdoc:get:comment:node:value', comment) !== void 0) { temp.push(comment); }
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

      const docData = [];
      const lastComment = comments[comments.length - 1];

      for (const comment of comments)
      {
         const tags = this._eventbus.triggerSync('tjsdoc:parse:comment', comment);

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

         if (doc) { docData.push(doc.value); }
      }

      return docData;
   }

   /**
    * Unwraps exported node.
    *
    * @param {ASTNode} node - target node that is export declaration node.
    *
    * @returns {ASTNode|null} unwrapped child node of exported node.
    * @private
    */
   _unwrapExportDeclaration(node)
   {
      // e.g. `export A from './A.js'` has not declaration
      if (!node.declaration) { return null; }

      const exportedASTNode = node.declaration;

      if (!exportedASTNode.leadingComments) { exportedASTNode.leadingComments = []; }

      exportedASTNode.leadingComments.push(...node.leadingComments || []);

      if (!exportedASTNode.trailingComments) { exportedASTNode.trailingComments = []; }

      exportedASTNode.trailingComments.push(...node.trailingComments || []);

      return exportedASTNode;
   }
}
