import babelGenerator         from 'babel-generator';
import ModuleFunctionDocBase  from 'tjsdoc-docs-common/src/doc/base/ModuleFunctionDocBase.js';

/**
 * Doc Class from Function declaration AST node.
 */
export default class ModuleFunctionDoc extends ModuleFunctionDocBase
{
   /**
    * Assign async property from self node.
    */
   static _$async()
   {
      this._value.async = this._node.async;
   }

   /** Assign generator property from self node */
   static _$generator()
   {
      this._value.generator = this._node.generator;
   }

   /** Take out self name from self node */
   static _$name()
   {
      // Provide special handling when this doc is an `ArrowFunctionExpression` or `FunctionExpression`.
      if (this._node.type === 'ArrowFunctionExpression' || this._node.type === 'FunctionExpression')
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
         if (this._node.id.type === 'MemberExpression')
         {
            // e.g. foo[bar.baz] = function bal(){}
            const expression = babelGenerator(this._node.id).code;
            this._value.name = `[${expression}]`;
         }
         else
         {
            this._value.name = this._node.id.name;
         }
      }
      else
      {
         this._value.name = this._eventbus.triggerSync('tjsdoc:system:filepath:to:name', this._pathResolver.filePath);
      }
   }

   /** If @param does not exist then guess type of param by using self node. */
   static _$param()
   {
      super._$param();

      if (this._value.params) { return; }

      this._value.params = this._eventbus.triggerSync('tjsdoc:system:parser:param:guess', this._node.params);
   }

   /** If @return does not exist then guess type of return by using self node. */
   static _$return()
   {
      super._$return();

      if (this._value.return) { return; }

      const result = this._eventbus.triggerSync('tjsdoc:system:parser:param:return:guess', this._node.body);

      if (result)
      {
         this._value.return = result;
      }
   }
}
