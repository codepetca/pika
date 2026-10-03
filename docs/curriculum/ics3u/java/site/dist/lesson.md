# Java explained

## Java in ICS3U


How written instructions become a running program

We will use Java in this course. Today, we will learn what code is and how Java runs.

By the end, you can explain **source code**, **syntax**, **compiler**, and **Java Virtual Machine**.

## Programming and code


**Programming** means writing instructions that a computer can carry out.

The text a programmer writes is **source code**. A **programming language** gives us rules for expressing those instructions.

Java is one programming language. Python and JavaScript are others.

> Think about it: What instructions would a program need to calculate a student's average?

## Programmer and user


A **programmer** creates and tests a program to meet a user's needs.

A **user** runs or interacts with the program. They can use it without understanding its code.

In this course, you will often be both.

> Example: A programmer builds a calculator. A user enters numbers and reads the result.

## Syntax


**Syntax** means the rules for writing code.

```java
System.out.println("Hello!");
```

This Java statement displays **Hello!** and then starts a new line.

Capitalization, quotation marks, and punctuation matter. Java checks its syntax rules before the program runs.

> Think about it: What might happen if a programmer leaves out a quotation mark?

## Our coding environment


We will write Java in the **CodeHS online editor**. We may also use Replit.

A **code editor** helps us write and change source code.

An **integrated development environment (IDE)** brings an editor and development tools together, such as tools to run code and find errors.

An editor can point out mistakes. The programmer still has to decide what the program should do.

## Source code, compiler, bytecode


Java source code lives in text files ending in **.java**.

The **compiler** translates Java source code into **bytecode**, stored in **.class** files.

```flow
Source code | Main.java | The text we write
Compiler | javac | Translates the source code
Bytecode | Main.class | The compiled instructions
JVM | Run | Executes the bytecode
```

Our online coding environment handles the compilation step when we run a program.

## The Java Virtual Machine


The **Java Virtual Machine (JVM)** executes Java bytecode.

The compiler produces bytecode. The JVM runs it.

If the source code breaks a syntax rule, compilation fails. Read the error message, fix the code, and compile again.

A program can also run successfully and still produce the wrong result. That is why programmers test their work.

## Java on different computers


The same Java bytecode can run on different operating systems with a **compatible JVM**.

```platforms
Windows | JVM for Windows
macOS | JVM for macOS
Linux | JVM for Linux
```

The JVM provides the connection between Java bytecode and the system running it.

Java and JavaScript are separate languages. Modern browsers do not run Java applets through a built-in JVM.

## Check your understanding


- What is the difference between source code and syntax?
- What does a Java compiler produce?
- What does the JVM do?
- Can a program run successfully and still be wrong? Explain.

Next lesson: writing and running a Java program.
