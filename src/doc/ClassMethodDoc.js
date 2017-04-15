import babelGenerator      from 'babel-generator';
import ClassMethodDocBase  from 'tjsdoc-docs-common/src/doc/base/ClassMethodDocBase';

/**
 * Doc Class from Method Definition AST node.
 */
export default class ClassMethodDoc extends ClassMethodDocBase
{
   /** Use kind property of self node to determine if method is an accessor (get / set). */
   static _$accessor()
   {
      this._value.accessor = this._node.kind === 'get' || this._node.kind === 'set';
   }

   /**
    * use async property of self node.
    */
   static _$async()
   {
      this._value.async = this._node.async;
   }

   /** specify `ClassMember` to category if the method is an accessor (get / set) otherwise `ClassMethod`. */
   static _$category()
   {
      this._value.category = this._node.kind === 'get' || this._node.kind === 'set' ? 'ClassMember' : 'ClassMethod';
   }

   /** use generator property of self node. */
   static _$generator()
   {
      this._value.generator = this._node.generator;
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

   /** If @param does not exist guess type of param by using self node. but accessors are not guessed. */
   static _$param()
   {
      super._$param();

      if (this._value.params) { return; }

      this._ensureApplied('_$accessor');

      if (this._value.accessor) { return; }

      this._value.params = this._eventbus.triggerSync('tjsdoc:system:parser:param:guess', this._node.params);
   }

   /** Use kind property of self node to assign method qualifier (constructor, get, method, set). */
   static _$qualifier()
   {
      this._value.qualifier = this._node.kind;
   }

   /**
    * if @return is not exists, guess type of return by using self node.
    * but ``constructor``, ``get`` and ``set``are not guessed.
    */
   static _$return()
   {
      super._$return();

      if (this._value.return) { return; }

      this._ensureApplied('_$category');

      switch (this._value.category)
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
      if ('static' in this._node) { this._value.static = this._node.static; }
   }

   /** if @type is not exists, guess type by using self node. only ``get`` and ``set`` are guess. */
   static _$type()
   {
      super._$type();

      if (this._value.type) { return; }

      this._ensureApplied('_$category');

      switch (this._value.category)
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
