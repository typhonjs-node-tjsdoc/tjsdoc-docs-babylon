import ModuleClassDocBase  from 'tjsdoc-docs-common/src/doc/base/ModuleClassDocBase.js';

/**
 * Doc Class from Class Declaration AST node.
 */
export default class ModuleClassDoc extends ModuleClassDocBase
{
   /** Support for @extends and direct ES module inheritance. */
   static _$extends()
   {
      const values = this._findAllTagValues(['@extends']);

      if (values)
      {
         this._value.extends = [];

         for (const value of values)
         {
            const { typeText } = this._eventbus.triggerSync('tjsdoc:system:parser:param:value:parse', value,
             { type: true, name: false, desc: false });

            this._value.extends.push(typeText);
         }

         return;
      }

      if (this._node.superClass)
      {
         const node = this._node;
         const targets = [];

         let longnames = [];

         if (node.superClass.type === 'CallExpression')
         {
            targets.push(node.superClass.callee, ...node.superClass.arguments);
         }
         else
         {
            targets.push(node.superClass);
         }

         for (const target of targets)
         {
            switch (target.type)
            {
               case 'Identifier':
                  longnames.push(this._resolveLongname(target.name));
                  break;

               case 'MemberExpression':
               {
                  const fullIdentifier = this._eventbus.triggerSync('tjsdoc:system:ast:member:expression:flatten',
                   target);

                  const rootIdentifier = fullIdentifier.split('.')[0];

                  const rootLongname = this._resolveLongname(rootIdentifier);

                  const filePath = rootLongname.replace(/~.*/, '');

                  longnames.push(`${filePath}~${fullIdentifier}`);
                  break;
               }
            }
         }

         if (node.superClass.type === 'CallExpression')
         {
            // expression extends may be a Class or a function, so filter by leading upper or lowercase.
            longnames = longnames.filter((v) => v.match(/^[a-zA-Z]|^[$_][a-zA-Z]/));

            const filePath = this._pathResolver.absolutePath;
            const line = node.superClass.loc.start.line;
            const start = node.superClass.loc.start.column;
            const end = node.superClass.loc.end.column;

            this._value.expressionExtends = this._readSelection(filePath, line, start, end);
         }

         if (longnames.length) { this._value.extends = longnames; }
      }
   }

   /** Take out self name from self node */
   static _$name()
   {
      // Provide special handling when this doc is a `ClassExpression`.
      if (this._node.type === 'ClassExpression')
      {
         // Handle case when parent node is `AssignmentExpression` or `VariableDeclaration`.
         switch (this._node.parent.type)
         {
            case 'AssignmentExpression':
            {
               const assignmentNode = this._node.parent;

               switch (assignmentNode.left.type)
               {
                  case 'Identifier':
                     this._value.name = assignmentNode.left.name;
                     return;

                  case 'MemberExpression':
                     this._value.name = assignmentNode.left.property.name;
                     return;
               }
               break;
            }

            case 'VariableDeclaration':
               this._value.name = this._node.parent.declarations[0].id.name;
               return;
         }
      }

      // Derive name from `this._node`.
      if (this._node.id)
      {
         this._value.name = this._node.id.name;
      }
      else
      {
         this._value.name = this._eventbus.triggerSync('tjsdoc:system:filepath:to:name', this._pathResolver.filePath);
      }
   }
}
