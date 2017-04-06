import babelGenerator from 'babel-generator';

/**
 * Provides several utility methods and event bindings to manipulate Babylon AST.
 */
export default class ASTUtil
{
   /**
    * Create VariableDeclaration node that has NewExpression.
    *
    * @param {string} name - variable name.
    * @param {string} className - class name.
    * @param {ASTNode} sourceNode - source node.
    *
    * @returns {ASTNode} created node.
    */
   createVariableDeclarationAndNewExpressionNode(name, className, sourceNode)
   {
      return {
         type: 'VariableDeclaration',
         kind: 'let',
         loc: sourceNode.loc,
         leadingComments: sourceNode.leadingComments,
         declarations:
         [
            {
               type: 'VariableDeclarator',
               id: { type: 'Identifier', name },
               init: { type: 'NewExpression', callee: { type: 'Identifier', name: className } }
            }
         ]
      };
   }

   /**
    * Find ClassDeclaration node.
    *
    * @param {AST}      ast - find in this ast.
    *
    * @param {string}   name - class name.
    *
    * @returns {ASTNode|null} found ast node.
    */
   findClassDeclarationExport(ast, name)
   {
      if (!name) { return null; }

      // find in same file.
      for (const node of ast.program.body)
      {
         switch (node.type)
         {
            case 'ExportDefaultDeclaration':
            case 'ExportNamedDeclaration':
               break;

            default:
               continue;
         }

         if (node.declaration && node.declaration.type === 'ClassDeclaration' && node.declaration.id.name === name)
         {
            return node;
         }
      }

      return null;
   }

   /**
    * find ClassDeclaration node.
    *
    * @param {AST} ast - find in this ast.
    *
    * @param {string} name - class name.
    *
    * @returns {ASTNode|null} found ast node.
    */
   findClassDeclarationNode(ast, name)
   {
      if (!name) { return null; }

      for (const node of ast.program.body)
      {
         if (node.type === 'ClassDeclaration' && node.id.name === name) { return node; }
      }

      return null;
   }

   /**
    * find FunctionDeclaration node.
    *
    * @param {AST} ast - find in this ast.
    *
    * @param {string} name - function name.
    *
    * @returns {ASTNode|null} found ast node.
    */
   findFunctionDeclarationNode(ast, name)
   {
      if (!name) { return null; }

      for (const node of ast.program.body)
      {
         if (node.type === 'FunctionDeclaration' && node.id.name === name) { return node; }
      }

      return null;
   }

   /**
    * Finds any attached decorators
    *
    * @param {ASTNode}  node - An AST node.
    *
    * @returns {Array<Decorator>|undefined}
    */
   findDecorators(node)
   {
      if (!node.decorators) { return; }

      const decorators = [];

      for (const decorator of node.decorators)
      {
         const value = {};

         switch (decorator.expression.type)
         {
            case 'Identifier':
               value.name = decorator.expression.name;
               value.arguments = null;
               break;

            case 'CallExpression':
               value.name = decorator.expression.callee.name;
               value.arguments = babelGenerator(decorator.expression).code.replace(/^[^(]+/, '');
               break;

            default:
               throw new Error(`unknown decorator expression type: ${decorator.expression.type}`);
         }

         decorators.push(value);
      }

      return decorators;
   }

   /**
    * Finds the start line number for an AST node.
    *
    * @param {ASTNode}  node - An AST node.
    *
    * @returns {number|undefined}
    */
   findLineNumberStart(node)
   {
      let number;

      if (node.loc) { number = node.loc.start.line; }

      return number;
   }

   /**
    * Determines the import style of the given node from it's parent node.
    *
    * @param {ASTNode}  node - An AST node.
    *
    * @param {string}   name - Name of the doc tag.
    *
    * @returns {string|null}
    */
   findImportStyle(node, name)
   {
      let parent = node.parent;

      let importStyle = null;

      while (parent)
      {
         if (parent.type === 'ExportDefaultDeclaration')
         {
            importStyle = name;

            break;
         }
         else if (parent.type === 'ExportNamedDeclaration')
         {
            importStyle = `{${name}}`;

            break;
         }
         parent = parent.parent;
      }

      return importStyle;
   }

   /**
    * Finds any parent export nodes.
    *
    * @param {ASTNode}  node - An AST node.
    *
    * @returns {boolean}
    */
   findParentExport(node)
   {
      let parent = node.parent;

      let exported = false;

      while (parent)
      {
         if (parent.type === 'ExportDefaultDeclaration')
         {
            exported = true;
         }
         else if (parent.type === 'ExportNamedDeclaration')
         {
            exported = true;
         }

         parent = parent.parent;
      }

      return exported;
   }

   /**
    * find file path in import declaration by name.
    * e.g. can find ``./foo/bar.js`` from ``import Bar from './foo/bar.js'`` by ``Bar``.
    *
    * @param {AST} ast - target AST.
    * @param {string} name - identifier name.
    *
    * @returns {string|null} file path.
    */
   findPathInImportDeclaration(ast, name)
   {
      let path = null;

      this._eventbus.trigger('typhonjs:ast:walker:traverse', ast,
      {
         enterNode: (node) =>
         {
            if (node.type !== 'ImportDeclaration') { return; }

            for (const spec of node.specifiers)
            {
               const localName = spec.local.name;
               if (localName === name)
               {
                  path = node.source.value;
                  return null;  // Quit traversal
               }
            }
         }
      });

      return path;
   }

   /**
    * find VariableDeclaration node which has NewExpression.
    *
    * @param {AST} ast - find in this ast.
    *
    * @param {string} name - variable name.
    *
    * @returns {ASTNode|null} found ast node.
    */
   findVariableDeclarationAndNewExpressionNode(ast, name)
   {
      if (!name) { return null; }

      for (const node of ast.program.body)
      {
         if (node.type === 'VariableDeclaration' && node.declarations[0].init &&
          node.declarations[0].init.type === 'NewExpression' && node.declarations[0].id.name === name)
         {
            return node;
         }
      }

      return null;
   }

   /**
    * find VariableDeclaration node.
    *
    * @param {AST} ast - find in this ast.
    *
    * @param {string} name - variable name.
    *
    * @returns {ASTNode|null} found ast node.
    */
   findVariableDeclarationNode(ast, name)
   {
      if (!name) { return null; }

      for (const node of ast.program.body)
      {
         if (node.type === 'VariableDeclaration' && node.declarations[0].id.name === name) { return node; }
      }

      return null;
   }

   /**
    * flatten member expression property name.
    * if node structure is [foo [bar [baz [this] ] ] ], flatten is ``this.baz.bar.foo``
    *
    * @param {ASTNode} node - target member expression node.
    *
    * @returns {string} flatten property.
    */
   flattenMemberExpression(node)
   {
      const results = [];
      let target = node;

      while (target)
      {
         if (target.type === 'ThisExpression')
         {
            results.push('this');
            break;
         }
         else if (target.type === 'Identifier')
         {
            results.push(target.name);
            break;
         }
         else // MemberExpression
         {
            results.push(target.property.name);
            target = target.object;
         }
      }

      return results.reverse().join('.');
   }

   /**
    * Gets the last leading comment before a node including the first line of the node from in memory code returning
    * an object with keys: text, startLine, and endLine. If there is no leading comment the previous 10 lines from
    * the nodes first line is returned.
    *
    * @param {ASTNode}  node - An AST node.
    *
    * @param {string}   code - In memory code.
    *
    * @param {boolean}  [allComments=false] - If true then all leading comments are included.
    *
    * @returns {{text: string, startLine: number, endLine: number }} The last comment & method signature w/
    *                                                                start & end line numbers.
    */
   getCodeCommentAndFirstLineFromNode(node, code, allComments = false)
   {
      if (typeof code !== 'string') { throw new TypeError(`'code' is not a 'string'.`); }
      if (typeof node !== 'object') { throw new TypeError(`'node' is not an 'object'.`); }

      const lines = code.split('\n');
      const targetLines = [];

      // If the node has a leading comment then include the last one before the method signature.
      if (Array.isArray(node.leadingComments) && node.leadingComments.length > 0)
      {
         // If `allComments` is true then include all leading comments otherwise by default just the last one.
         const comment = node.leadingComments[allComments ? 0 : node.leadingComments.length - 1];

         const startLine = Math.max(0, comment.loc.start.line - 1);
         const endLine = node.loc.start.line;

         for (let cntr = startLine; cntr < endLine; cntr++)
         {
            targetLines.push(`${cntr + 1}| ${lines[cntr]}`);
         }

         return { text: targetLines.join('\n'), startLine, endLine };
      }
      else // Otherwise just return up to 10 lines before the first line of the node.
      {
         const endLine = node.loc.start.line;
         const startLine = Math.max(0, endLine - 10);

         for (let cntr = startLine; cntr < endLine; cntr++)
         {
            targetLines.push(`${cntr + 1}| ${lines[cntr]}`);
         }

         return { text: targetLines.join('\n'), startLine, endLine };
      }
   }

   /**
    * Gets the last leading comment before a node including the first line of the node from a file returning
    * an object with keys: text, startLine, and endLine. If there is no leading comment the previous 10 lines from
    * the nodes first line is returned.
    *
    * @param {ASTNode}  node - An AST node.
    *
    * @param {string}   filePath - An absolute file path to read.
    *
    * @param {boolean}  [allComments=false] - If true then all leading comments are included.
    *
    * @returns {{text: string, startLine: number, endLine: number }} The last comment & method signature w/
    *                                                                start & end line numbers.
    */
   getFileCommentAndFirstLineFromNode(node, filePath, allComments = false)
   {
      if (typeof filePath !== 'string') { throw new TypeError(`'filePath' is not a 'string'.`); }
      if (typeof node !== 'object') { throw new TypeError(`'node' is not an 'object'.`); }

      // If the node has a leading comment then include the last one before the method signature.
      if (Array.isArray(node.leadingComments) && node.leadingComments.length > 0)
      {
         // If `allComments` is true then include all leading comments otherwise by default just the last one.
         const comment = node.leadingComments[allComments ? 0 : node.leadingComments.length - 1];

         const startLine = comment.loc.start.line - 1;
         const endLine = node.loc.start.line;

         const targetLines = this._eventbus.triggerSync('typhonjs:util:file:lines:read', filePath, startLine, endLine);

         return { text: targetLines.join('\n'), startLine, endLine };
      }
      else // Otherwise just return up to 10 lines before the first line of the node.
      {
         const endLine = node.loc.start.line;
         const startLine = endLine - 10;

         const targetLines = this._eventbus.triggerSync('typhonjs:util:file:lines:read', filePath, startLine, endLine);

         return { text: targetLines.join('\n'), startLine, endLine };
      }
   }

   /**
    * Get variable names from method arguments.
    *
    * @param {ASTNode} node - target node.
    *
    * @returns {string[]} variable names.
    */
   getMethodParamsFromNode(node)
   {
      let params;

      switch (node.type)
      {
         case 'FunctionExpression':
         case 'FunctionDeclaration':
            params = node.params || [];
            break;

         case 'ClassMethod':
            params = node.params || [];
            break;

         case 'ArrowFunctionExpression':
            params = node.params || [];
            break;

         default:
            throw new Error(`unknown node type. type = ${node.type}`);
      }

      const result = [];

      for (const param of params)
      {
         switch (param.type)
         {
            case 'Identifier':
               result.push(param.name);
               break;

            case 'AssignmentPattern':
               if (param.left.type === 'Identifier')
               {
                  result.push(param.left.name);
               }
               else if (param.left.type === 'ObjectPattern')
               {
                  result.push('*');
               }
               break;

            case 'RestElement':
               result.push(param.argument.name);
               break;

            case 'ObjectPattern':
               result.push('*');
               break;

            case 'ArrayPattern':
               result.push('*');
               break;

            default:
               throw new Error(`unknown param type: ${param.type}`);
         }
      }

      return result;
   }

   /**
    * Wires up BabylonASTUtil on the plugin eventbus and stores it in a local module scope variable.
    *
    * @param {PluginEvent} ev - The plugin event.
    *
    * @ignore
    */
   onPluginLoad(ev)
   {
      /**
       * Stores the plugin eventbus proxy.
       * @type {EventProxy}
       */
      this._eventbus = ev.eventbus;

      this._eventbus.on('tjsdoc:system:ast:class:declaration:find', this.findClassDeclarationNode, this);

      this._eventbus.on('tjsdoc:system:ast:code:comment:first:line:from:node:get',
       this.getCodeCommentAndFirstLineFromNode, this);

      this._eventbus.on('tjsdoc:system:ast:decorators:find', this.findDecorators, this);

      this._eventbus.on('tjsdoc:system:ast:export:declaration:class:find', this.findClassDeclarationExport, this);

      this._eventbus.on('tjsdoc:system:ast:file:comment:first:line:from:node:get',
       this.getFileCommentAndFirstLineFromNode, this);

      this._eventbus.on('tjsdoc:system:ast:function:declaration:find', this.findFunctionDeclarationNode, this);

      this._eventbus.on('tjsdoc:system:ast:import:style:find', this.findImportStyle, this);

      this._eventbus.on('tjsdoc:system:ast:line:number:start:find', this.findLineNumberStart, this);

      this._eventbus.on('tjsdoc:system:ast:member:expression:flatten', this.flattenMemberExpression, this);

      this._eventbus.on('tjsdoc:system:ast:method:params:from:node:get', this.getMethodParamsFromNode, this);

      this._eventbus.on('tjsdoc:system:ast:node:sanitize', this.sanitize, this);

      this._eventbus.on('tjsdoc:system:ast:node:sanitize:children', this.sanitizeChildren, this);

      this._eventbus.on('tjsdoc:system:ast:parent:export:find', this.findParentExport, this);

      this._eventbus.on('tjsdoc:system:ast:path:import:declaration:find', this.findPathInImportDeclaration, this);

      this._eventbus.on('tjsdoc:system:ast:variable:declaration:find', this.findVariableDeclarationNode, this);

      this._eventbus.on('tjsdoc:system:ast:variable:declaration:new:expression:create',
       this.createVariableDeclarationAndNewExpressionNode, this);

      this._eventbus.on('tjsdoc:system:ast:variable:declaration:new:expression:find',
       this.findVariableDeclarationAndNewExpressionNode, this);
   }

   /**
    * sanitize node. change node type to `Identifier` and empty comment.
    *
    * @param {ASTNode} node - target node.
    */
   sanitize(node)
   {
      if (!node) { return; }

      node.type = 'Identifier';
      node.name = '_';
      node.leadingComments = [];
      node.trailingComments = [];
   }

   /**
    * Removes all unnecessary children nodes leaving comments and range data. A new object is created and data
    * copied before being returned.
    *
    * @param {ASTNode} node - target node.
    *
    * @returns {ASTNode} - sanitized AST node.
    */
   sanitizeChildren(node)
   {
      if (!node) { return; }

      const newNode = {};

      for (const prop in node)
      {
         switch (prop)
         {
            case 'end':
            case 'leadingComments':
            case 'loc':
            case 'start':
            case 'trailingComments':
            case 'type':
               newNode[prop] = node[prop];
               break;
         }
      }

      return JSON.parse(JSON.stringify(newNode));
   }
}
