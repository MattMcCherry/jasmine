getJasmineRequireObj().MockDate = function(j$) {
  function MockDate(global, env) {
    let currentTime = 0;
    let originalIntl = null;
    let fakeIntl = null;

    if (!global || !global.Date) {
      this.install = function() {};
      this.tick = function() {};
      this.uninstall = function() {};
      return this;
    }

    const GlobalDate = global.Date;

    this.install = function(mockDate) {
      if (mockDate instanceof GlobalDate) {
        currentTime = mockDate.getTime();
      } else {
        if (mockDate !== undefined) {
          throw new Error(
            'The argument to jasmine.clock().mockDate(), if specified, ' +
              'should be a Date instance.'
          );
        }

        currentTime = new GlobalDate().getTime();
      }

      global.Date = FakeDate;

      if (
        env &&
        env.configuration().mockIntlDateTimeFormat &&
        global.Intl &&
        typeof global.Intl === 'object'
      ) {
        originalIntl = global.Intl;
        fakeIntl = this.createIntl();
        if (fakeIntl) {
          global.Intl = fakeIntl;
        }
      }
    };

    this.tick = function(millis) {
      millis = millis || 0;
      currentTime = currentTime + millis;
    };

    this.uninstall = function() {
      currentTime = 0;
      global.Date = GlobalDate;

      if (originalIntl !== null) {
        global.Intl = originalIntl;
        originalIntl = null;
        fakeIntl = null;
      }
    };

    this.createIntl = function() {
      if (!global.Intl || typeof global.Intl !== 'object') {
        return null;
      }

      const NativeIntl = global.Intl;
      const ClockIntl = {};

      Object.getOwnPropertyNames(NativeIntl).forEach(function(property) {
        ClockIntl[property] = NativeIntl[property];
      });

      const DateTimeFormatProxy = new Proxy(NativeIntl.DateTimeFormat, {
        construct(target, argArray, newTarget) {
          const realFormatter = Reflect.construct(target, argArray, newTarget);
          return new Proxy(realFormatter, {
            get(formatterTarget, prop) {
              const originalMethod = formatterTarget[prop];
              if (
                typeof prop === 'string' &&
                ['format', 'formatToParts'].includes(prop)
              ) {
                return function formatClockCompatible(...args) {
                  return Reflect.apply(
                    originalMethod,
                    formatterTarget,
                    args.length === 0 ? [new FakeDate()] : args
                  );
                };
              }
              return function reflectBoundMethod(...args) {
                // using Reflect.apply as original constructor's Date is expected to be called by the browser otherwise we get incompatible receiver errors.
                return Reflect.apply(originalMethod, formatterTarget, args);
              };
            }
          });
        }
      });

      ClockIntl.DateTimeFormat = DateTimeFormatProxy;

      ClockIntl.DateTimeFormat.prototype = Object.create(
        NativeIntl.DateTimeFormat.prototype
      );

      ClockIntl.DateTimeFormat.supportedLocalesOf =
        NativeIntl.DateTimeFormat.supportedLocalesOf;

      return ClockIntl;
    };

    createDateProperties();

    return this;

    function FakeDate() {
      switch (arguments.length) {
        case 0:
          return new GlobalDate(currentTime);
        case 1:
          return new GlobalDate(arguments[0]);
        case 2:
          return new GlobalDate(arguments[0], arguments[1]);
        case 3:
          return new GlobalDate(arguments[0], arguments[1], arguments[2]);
        case 4:
          return new GlobalDate(
            arguments[0],
            arguments[1],
            arguments[2],
            arguments[3]
          );
        case 5:
          return new GlobalDate(
            arguments[0],
            arguments[1],
            arguments[2],
            arguments[3],
            arguments[4]
          );
        case 6:
          return new GlobalDate(
            arguments[0],
            arguments[1],
            arguments[2],
            arguments[3],
            arguments[4],
            arguments[5]
          );
        default:
          return new GlobalDate(
            arguments[0],
            arguments[1],
            arguments[2],
            arguments[3],
            arguments[4],
            arguments[5],
            arguments[6]
          );
      }
    }

    function createDateProperties() {
      FakeDate.prototype = GlobalDate.prototype;

      FakeDate.now = function() {
        return currentTime;
      };

      FakeDate.toSource = GlobalDate.toSource;
      FakeDate.toString = GlobalDate.toString;
      FakeDate.parse = GlobalDate.parse;
      FakeDate.UTC = GlobalDate.UTC;
    }
  }

  return MockDate;
};
