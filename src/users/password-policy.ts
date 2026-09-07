import { BadRequestException } from '@nestjs/common';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
export const PASSWORD_POLICY_MESSAGE =
  'Mínimo 8 caracteres, con al menos una letra y un número.';
export const PASSWORD_MAX_MESSAGE = 'Máximo 200 caracteres.';

export function evaluateUserPassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.trim() === '') {
    return PASSWORD_POLICY_MESSAGE;
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return PASSWORD_POLICY_MESSAGE;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return PASSWORD_MAX_MESSAGE;
  }
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return null;
}

export function assertUserPasswordPolicy(password: string): void {
  const error = evaluateUserPassword(password);
  if (error) {
    throw new BadRequestException(error);
  }
}

export function IsUserPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isUserPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return evaluateUserPassword(value) === null;
        },
        defaultMessage(args: ValidationArguments) {
          return evaluateUserPassword(args.value) ?? PASSWORD_POLICY_MESSAGE;
        },
      },
    });
  };
}
