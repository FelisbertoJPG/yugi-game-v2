using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(CharacterController))]
public class PlayerMovement : MonoBehaviour
{
    [Header("Referências")]
    [SerializeField] private Transform visualModel;
    [SerializeField] private Transform cameraTransform;

    [Header("Movimento")]
    [SerializeField] private float moveSpeed = 4f;
    [SerializeField] private float rotationSpeed = 12f;

    [Header("Gravidade")]
    [SerializeField] private float gravity = -20f;
    [SerializeField] private float groundedGravity = -2f;

    private CharacterController controller;
    private InputAction moveAction;

    private Vector3 moveDirection = Vector3.zero;
    private float verticalVelocity = 0f;

    private void Awake()
    {
        controller = GetComponent<CharacterController>();

        moveAction = new InputAction(
            name: "Move",
            type: InputActionType.Value
        );

        moveAction.AddCompositeBinding("2DVector")
            .With("Up", "<Keyboard>/w")
            .With("Down", "<Keyboard>/s")
            .With("Left", "<Keyboard>/a")
            .With("Right", "<Keyboard>/d");

        moveAction.AddCompositeBinding("2DVector")
            .With("Up", "<Keyboard>/upArrow")
            .With("Down", "<Keyboard>/downArrow")
            .With("Left", "<Keyboard>/leftArrow")
            .With("Right", "<Keyboard>/rightArrow");

        moveAction.AddBinding("<Gamepad>/leftStick");
    }

    private void OnEnable()
    {
        moveAction?.Enable();
    }

    private void OnDisable()
    {
        moveAction?.Disable();
    }

    private void OnDestroy()
    {
        moveAction?.Dispose();
    }

    private void Update()
    {
        ReadMovementInput();
        ApplyGravity();
        MovePlayer();
        RotateVisual();
    }

    private void ReadMovementInput()
    {
        Vector2 input = moveAction.ReadValue<Vector2>();

        if (cameraTransform == null)
        {
            moveDirection = new Vector3(input.x, 0f, input.y);

            if (moveDirection.sqrMagnitude > 1f)
            {
                moveDirection.Normalize();
            }

            return;
        }

        Vector3 cameraForward = Vector3.ProjectOnPlane(cameraTransform.forward, Vector3.up).normalized;
        Vector3 cameraRight = Vector3.ProjectOnPlane(cameraTransform.right, Vector3.up).normalized;

        moveDirection = (cameraForward * input.y) + (cameraRight * input.x);

        if (moveDirection.sqrMagnitude > 1f)
        {
            moveDirection.Normalize();
        }
    }

    private void ApplyGravity()
    {
        if (controller.isGrounded && verticalVelocity < 0f)
        {
            verticalVelocity = groundedGravity;
        }

        verticalVelocity += gravity * Time.deltaTime;
    }

    private void MovePlayer()
    {
        Vector3 horizontalVelocity = moveDirection * moveSpeed;
        Vector3 finalVelocity = horizontalVelocity + (Vector3.up * verticalVelocity);

        controller.Move(finalVelocity * Time.deltaTime);
    }

    private void RotateVisual()
    {
        if (visualModel == null)
        {
            return;
        }

        if (moveDirection.sqrMagnitude <= 0.001f)
        {
            return;
        }

        Quaternion targetRotation = Quaternion.LookRotation(moveDirection, Vector3.up);

        visualModel.rotation = Quaternion.Slerp(
            visualModel.rotation,
            targetRotation,
            rotationSpeed * Time.deltaTime
        );
    }
}