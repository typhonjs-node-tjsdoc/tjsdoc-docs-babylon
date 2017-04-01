import babelGenerator      from 'babel-generator';
import ClassMethodDocBase  from 'tjsdoc-docs-common/src/doc/base/ClassMethodDocBase';

/**
 * Doc Class from Method Definition AST node.
 */
export default class ClassMethodDoc extends ClassMethodDocBase
{
   /**
    * use async property of self node.
    */
   static _$async()
   {
      this._value.async = this._node.async;
   }

   /** use generator property of self node. */
   static _$generator()
   {
      this._value.generator = this._node.generator;
   }

   /** use kind property of self node. */
   static _$kind()
   {
      this._value.kind = this._node.kind;
   }

   /** take out memberof from parent class node */
   static _$memberof()
   {
      let memberof;
      let parent = this._node.parent;

      while (parent)
      {
         if (parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression')
         {
            memberof = `${this._pathResolver.filePath}~${parent._tjsdocDocName}`;
            this._value.memberof = memberof;
            return;
         }
         parent = parent.parent;
      }
   }

   /** take out self name from self node */
   static _$name()
   {
      if (this._node.computed)
      {
         const expression = babelGenerator(this._node.key).code;
         this._value.name = `[${expression}]`;
      }
      else
      {
         this._value.name = this._node.key.name;
      }
   }

   /** if @param is not exists, guess type of param by using self node. but ``get`` and ``set`` are not guessed. */
   static _$param()
   {
      super._$param();

      if (this._value.params) { return; }

      this._ensureApplied('_$kind');

      switch (this._value.kind)
      {
         case 'get':
         case 'set':
            return;
      }

      this._value.params = this._eventbus.triggerSync('tjsdoc:system:parser:param:guess', this._node.params);
   }

   /**
    * if @return is not exists, guess type of return by using self node.
    * but ``constructor``, ``get`` and ``set``are not guessed.
    */
   static _$return()
   {
      super._$return();

      if (this._value.return) { return; }

      this._ensureApplied('_$kind');

      switch (this._value.kind)
      {
         case 'constructor':
         case 'get':
         case 'set':
            return;
      }

      const result = this._eventbus.triggerSync('tjsdoc:system:parser:param:return:guess', this._node.body);

      if (result)
      {
         this._value.return = result;
      }
   }

   /**
    * decide `static`.
    */
   static _$static()
   {
      if ('static' in this._node)
      {
         this._value.static = this._node.static;
      }
   }

   /** if @type is not exists, guess type by using self node. only ``get`` and ``set`` are guess. */
   static _$type()
   {
      super._$type();

      if (this._value.type) { return; }

      this._ensureApplied('_$kind');

      switch (this._value.kind)
      {
         case 'set':
            this._value.type = this._eventbus.triggerSync('tjsdoc:system:parser:param:type:guess', this._node.right);
            break;

         case 'get':
         {
            const result = this._eventbus.triggerSync('tjsdoc:system:parser:param:return:guess', this._node.body);

            if (result) { this._value.type = result; }
            break;
         }
      }
   }
}